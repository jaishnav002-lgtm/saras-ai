import json
import logging
import math
import os
import shutil
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import faiss
import numpy as np

from app.config import Settings, settings as global_settings
from app.services.exceptions import InvalidResponseError

logger = logging.getLogger(__name__)


class PersistentFaissIndex:
    """
    Persistent FAISS vector index with stable vector-position to chunk-ID mapping.
    Maintains IndexFlatIP (cosine similarity over L2-normalized vectors).
    Provides atomic persistence, duplicate protection, chunk deletion, and recovery.
    """

    def __init__(
        self,
        index_dir: str,
        index_name: str = "default",
        model_name: str = "nvidia/nemotron-3-embed-1b",
        version: str = "v1",
    ):
        self.index_dir = Path(index_dir) / index_name
        self.index_name = index_name
        self.model_name = model_name
        self.version = version

        self.index_file = self.index_dir / "index.faiss"
        self.mapping_file = self.index_dir / "mapping.json"

        self._lock = threading.RLock()
        self.index: Optional[faiss.IndexFlatIP] = None
        self.chunk_ids: List[str] = []
        self.chunk_id_to_pos: Dict[str, int] = {}
        self.chunk_content_hashes: Dict[str, str] = {}
        self.dim: Optional[int] = None

        self._ensure_dir()
        self.load()

    def _ensure_dir(self) -> None:
        self.index_dir.mkdir(parents=True, exist_ok=True)

    @property
    def total_vectors(self) -> int:
        with self._lock:
            return self.index.ntotal if self.index is not None else 0

    def is_consistent(self) -> bool:
        """Verifies that the in-memory/disk FAISS count matches the mapping count exactly."""
        with self._lock:
            if self.index is None:
                return len(self.chunk_ids) == 0
            return (
                self.index.ntotal == len(self.chunk_ids)
                and len(self.chunk_ids) == len(self.chunk_id_to_pos)
                and len(self.chunk_ids) == len(self.chunk_content_hashes)
            )

    def _reset(self) -> None:
        self.index = None
        self.chunk_ids = []
        self.chunk_id_to_pos = {}
        self.chunk_content_hashes = {}
        self.dim = None

    def load(self) -> bool:
        """
        Loads the FAISS index and chunk ID mapping from disk.
        Returns True if successfully loaded and consistent, False otherwise.
        """
        with self._lock:
            if not self.index_file.exists() or not self.mapping_file.exists():
                self._reset()
                return False

            try:
                # 1. Load mapping metadata
                with open(self.mapping_file, "r", encoding="utf-8") as f:
                    meta = json.load(f)

                self.dim = meta.get("dim")
                self.chunk_ids = list(meta.get("chunk_ids", []))
                self.chunk_id_to_pos = {cid: idx for idx, cid in enumerate(self.chunk_ids)}
                self.chunk_content_hashes = dict(meta.get("chunk_content_hashes", {}))

                if (
                    not isinstance(self.dim, int)
                    or self.dim <= 0
                    or not all(isinstance(cid, str) and cid for cid in self.chunk_ids)
                    or len(self.chunk_ids) != len(self.chunk_id_to_pos)
                    or meta.get("model") != self.model_name
                    or meta.get("version") != self.version
                    or set(self.chunk_ids) != set(self.chunk_content_hashes)
                ):
                    raise ValueError("incompatible or invalid mapping metadata")

                # 2. Load FAISS index binary
                self.index = faiss.read_index(str(self.index_file))

                # 3. Consistency checks
                if self.dim is not None and self.index.d != self.dim:
                    logger.warning(
                        "Dimension mismatch in FAISS index %s: index.d=%d, meta.dim=%d",
                        self.index_name,
                        self.index.d,
                        self.dim,
                    )
                    self._reset()
                    return False

                if self.index.ntotal != len(self.chunk_ids):
                    logger.warning(
                        "Count mismatch in FAISS index %s: ntotal=%d, chunk_ids=%d",
                        self.index_name,
                        self.index.ntotal,
                        len(self.chunk_ids),
                    )
                    self._reset()
                    return False

                return True

            except Exception as exc:
                logger.error("Failed to load FAISS index %s: %s", self.index_name, exc)
                self._reset()
                return False

    def save(self) -> None:
        """Atomically persists the FAISS index and mapping to disk using temporary files."""
        with self._lock:
            if self.index is None or self.dim is None:
                return

            self._ensure_dir()

            # Write FAISS index atomically
            tmp_index_path = self.index_file.with_suffix(".tmp")
            faiss.write_index(self.index, str(tmp_index_path))

            # Write mapping metadata atomically
            tmp_mapping_path = self.mapping_file.with_suffix(".tmp")
            meta = {
                "dim": self.dim,
                "chunk_ids": self.chunk_ids,
                "chunk_content_hashes": self.chunk_content_hashes,
                "model": self.model_name,
                "version": self.version,
                "total": len(self.chunk_ids),
            }
            with open(tmp_mapping_path, "w", encoding="utf-8") as f:
                json.dump(meta, f, indent=2)

            # Atomic swap
            os.replace(tmp_index_path, self.index_file)
            os.replace(tmp_mapping_path, self.mapping_file)

    def add_chunks(
        self,
        chunk_ids: List[str],
        vectors: List[List[float]],
    ) -> int:
        """
        Adds new chunk vectors to the index.
        Filters out duplicate chunks that are already indexed.
        Returns the number of newly added chunks.
        """
        if not chunk_ids or not vectors:
            return 0

        if len(chunk_ids) != len(vectors):
            raise InvalidResponseError("chunk_ids and vectors length mismatch.")

        with self._lock:
            # 1. Filter out already indexed chunk IDs to prevent duplicate vectors
            new_ids: List[str] = []
            new_vecs: List[List[float]] = []

            seen_ids: Set[str] = set()
            for cid, vec in zip(chunk_ids, vectors):
                if not isinstance(cid, str) or not cid:
                    raise InvalidResponseError("chunk IDs must be non-empty strings.")
                if cid not in self.chunk_id_to_pos and cid not in seen_ids:
                    new_ids.append(cid)
                    new_vecs.append(vec)
                    seen_ids.add(cid)

            if not new_ids:
                return 0

            # 2. Check / initialize dimension
            self._validate_vectors(new_vecs)
            detected_dim = len(new_vecs[0])
            if self.index is None:
                self.dim = detected_dim
                self.index = faiss.IndexFlatIP(self.dim)
            elif detected_dim != self.dim:
                raise InvalidResponseError(
                    f"Vector dimension {detected_dim} does not match index dimension {self.dim}."
                )

            # 3. Convert to float32 numpy array and normalize for cosine similarity
            arr = np.array(new_vecs, dtype=np.float32)
            faiss.normalize_L2(arr)

            # 4. Add to FAISS index
            base_offset = len(self.chunk_ids)
            self.index.add(arr)

            # 5. Update mappings
            for idx, cid in enumerate(new_ids):
                pos = base_offset + idx
                self.chunk_ids.append(cid)
                self.chunk_id_to_pos[cid] = pos
                self.chunk_content_hashes[cid] = ""

            # 6. Save atomically
            self.save()

            return len(new_ids)

    @staticmethod
    def _validate_vectors(vectors: List[List[float]], expected_dim: Optional[int] = None) -> None:
        for vector in vectors:
            if not isinstance(vector, list) or not vector:
                raise InvalidResponseError("FAISS vectors must be non-empty lists.")
            if expected_dim is not None and len(vector) != expected_dim:
                raise InvalidResponseError(
                    f"Vector dimension {len(vector)} does not match index dimension {expected_dim}."
                )
            for value in vector:
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise InvalidResponseError("FAISS vectors must contain only finite numeric values.")

    def sync_chunks(
        self,
        chunk_ids: List[str],
        content_hashes: List[str],
        vectors: List[List[float]],
    ) -> int:
        """Add new chunks and replace vectors only when a chunk's content changed."""
        if not (len(chunk_ids) == len(content_hashes) == len(vectors)):
            raise InvalidResponseError("chunk IDs, content hashes, and vectors length mismatch.")
        if len(set(chunk_ids)) != len(chunk_ids) or not all(isinstance(h, str) and h for h in content_hashes):
            raise InvalidResponseError("sync_chunks requires unique IDs and non-empty content hashes.")
        self._validate_vectors(vectors, self.dim)
        with self._lock:
            changed_ids = [
                cid for cid, content_hash in zip(chunk_ids, content_hashes)
                if cid in self.chunk_id_to_pos and self.chunk_content_hashes.get(cid) != content_hash
            ]
            if changed_ids:
                self.delete_chunks(changed_ids)
            added = self.add_chunks(chunk_ids, vectors)
            for cid, content_hash in zip(chunk_ids, content_hashes):
                if cid in self.chunk_id_to_pos:
                    self.chunk_content_hashes[cid] = content_hash
            if added or changed_ids:
                self.save()
            return added

    def search(
        self,
        query_vector: List[float],
        top_k: int = 8,
    ) -> List[Dict[str, Any]]:
        """
        Performs vector similarity search against the index.
        Returns list of dicts with chunk_id, score (cosine similarity), and vector position.
        """
        with self._lock:
            if self.index is None or self.index.ntotal == 0:
                return []

            self._validate_vectors([query_vector], self.dim)

            if len(query_vector) != self.dim:
                raise InvalidResponseError(
                    f"Query vector dimension {len(query_vector)} does not match index dimension {self.dim}."
                )

            # Prepare and normalize query vector
            q_arr = np.array([query_vector], dtype=np.float32)
            faiss.normalize_L2(q_arr)

            actual_k = min(top_k, self.index.ntotal)
            scores, positions = self.index.search(q_arr, actual_k)

            results: List[Dict[str, Any]] = []
            for score, pos in zip(scores[0], positions[0]):
                if pos >= 0 and pos < len(self.chunk_ids):
                    cid = self.chunk_ids[pos]
                    results.append({
                        "chunk_id": cid,
                        "score": float(score),
                        "position": int(pos),
                    })

            return results

    def delete_chunks(self, chunk_ids_to_remove: List[str]) -> int:
        """
        Deletes the specified chunk IDs from the index.
        Reconstructs surviving vectors, rebuilds the index, and saves atomically.
        Returns the number of deleted chunks.
        """
        if not chunk_ids_to_remove:
            return 0

        with self._lock:
            if self.index is None or self.index.ntotal == 0:
                return 0

            remove_set = set(chunk_ids_to_remove)
            surviving_positions = [
                i for i, cid in enumerate(self.chunk_ids) if cid not in remove_set
            ]

            deleted_count = len(self.chunk_ids) - len(surviving_positions)
            if deleted_count == 0:
                return 0

            if len(surviving_positions) == 0:
                self.clear()
                return deleted_count

            # Reconstruct surviving vectors from IndexFlatIP
            surviving_vecs = np.zeros((len(surviving_positions), self.dim), dtype=np.float32)
            for new_idx, old_pos in enumerate(surviving_positions):
                surviving_vecs[new_idx] = self.index.reconstruct(old_pos)

            # Rebuild clean index with surviving vectors
            new_index = faiss.IndexFlatIP(self.dim)
            new_index.add(surviving_vecs)

            # Update mapping
            self.index = new_index
            self.chunk_ids = [self.chunk_ids[p] for p in surviving_positions]
            self.chunk_id_to_pos = {cid: idx for idx, cid in enumerate(self.chunk_ids)}
            self.chunk_content_hashes = {
                cid: self.chunk_content_hashes[cid] for cid in self.chunk_ids
            }

            self.save()
            return deleted_count

    def rebuild(
        self,
        chunk_ids: List[str],
        vectors: List[List[float]],
    ) -> None:
        """Completely replaces the index and mapping with the supplied vectors."""
        with self._lock:
            self.clear()
            if chunk_ids and vectors:
                self.add_chunks(chunk_ids, vectors)

    def clear(self) -> None:
        """Clears the in-memory index and removes persisted files on disk."""
        with self._lock:
            self._reset()

            if self.index_file.exists():
                try:
                    self.index_file.unlink()
                except Exception:
                    pass

            if self.mapping_file.exists():
                try:
                    self.mapping_file.unlink()
                except Exception:
                    pass


class FaissIndexManager:
    """
    Manages persistent FAISS indices scoped by subject or collection.
    Caches loaded indices in memory to avoid rebuilding across requests.
    """

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or global_settings
        self.base_dir = Path(self.settings.rag_index_dir)
        self._indices: Dict[str, PersistentFaissIndex] = {}
        self._lock = threading.Lock()

    def get_index(self, scope_id: str = "default") -> PersistentFaissIndex:
        """Returns or loads the persistent FAISS index for the given scope/subject."""
        if not scope_id or Path(scope_id).name != scope_id:
            raise ValueError("Index scope must be a simple non-empty directory name.")
        with self._lock:
            if scope_id not in self._indices:
                idx = PersistentFaissIndex(
                    index_dir=str(self.base_dir),
                    index_name=scope_id,
                    model_name=self.settings.nvidia_embedding_model,
                    version=self.settings.rag_embedding_version,
                )
                self._indices[scope_id] = idx
            return self._indices[scope_id]

    def remove_index(self, scope_id: str) -> None:
        """Deletes an index from cache and removes its files on disk."""
        with self._lock:
            idx = self._indices.pop(scope_id, None)
            if idx:
                idx.clear()
            # Also clean directory if empty
            target_dir = self.base_dir / scope_id
            if target_dir.exists():
                shutil.rmtree(target_dir, ignore_errors=True)

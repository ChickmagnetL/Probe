"""SQLite storage layer — connection management, schema, and DAO modules."""

from .connection import (
    close_connection,
    default_database_path,
    get_connection,
    open_connection,
    probe_fts_capabilities,
    reset_capability_cache,
    transaction,
)
from .schema import INDEXABLE_KINDS, initialize_schema

__all__ = [
    "INDEXABLE_KINDS",
    "close_connection",
    "default_database_path",
    "get_connection",
    "initialize_schema",
    "open_connection",
    "probe_fts_capabilities",
    "reset_capability_cache",
    "transaction",
]

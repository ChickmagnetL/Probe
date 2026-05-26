"""SQLite storage layer — connection management, schema, and DAO modules."""

from .connection import (
    close_connection,
    default_database_path,
    get_connection,
    open_connection,
    transaction,
)
from .schema import initialize_schema

__all__ = [
    "close_connection",
    "default_database_path",
    "get_connection",
    "initialize_schema",
    "open_connection",
    "transaction",
]

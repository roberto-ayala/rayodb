//! The virtual-scroll page cache.
//!
//! Nothing here is engine-specific: drivers hand over already-packed pages, so
//! the cache lives outside `drivers::pgsql` and every driver shares it.

/// Cell separator for packed format (Unit Separator, ASCII 0x1F)
pub const CELL_SEP: char = '\x1F';
/// Row separator for packed format (Record Separator, ASCII 0x1E)
pub const ROW_SEP: char = '\x1E';

/// A cached query: pre-packed page strings for zero-copy serving.
/// Each page is a single large String (~1-2 MB) so the OS reclaims RSS on drop.
pub struct CachedQuery {
    pub pages: Vec<String>,
    pub page_size: usize,
}

pub type VirtualCache = std::collections::BTreeMap<String, CachedQuery>;

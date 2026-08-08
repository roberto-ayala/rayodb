//! The packed wire format, shared by every driver.
//!
//! Results cross the IPC boundary as one string rather than nested JSON: cells
//! joined by `CELL_SEP`, rows by `ROW_SEP`. The frontend splits it back apart.
//! Keeping this out of any one engine's module is what lets a second driver
//! produce results the existing grid can already read.

use crate::drivers::cache::{CELL_SEP, ROW_SEP};

/// Join items with `sep`, sizing the buffer up front.
pub fn join_sep(items: &[String], sep: char) -> String {
    let total: usize = items.iter().map(|s| s.len()).sum::<usize>() + items.len();
    let mut out = String::with_capacity(total);
    for (i, item) in items.iter().enumerate() {
        if i > 0 {
            out.push(sep);
        }
        out.push_str(item);
    }
    out
}

/// Pack rows into wire format, without the header line.
pub fn pack_rows_vec(rows: &[Vec<String>]) -> String {
    if rows.is_empty() {
        return String::new();
    }
    // Estimate capacity: avg ~20 chars per cell
    let est = rows.len() * rows.first().map_or(10, |r| r.len()) * 20;
    let mut out = String::with_capacity(est);

    for (ri, row) in rows.iter().enumerate() {
        if ri > 0 {
            out.push(ROW_SEP);
        }
        for (ci, cell) in row.iter().enumerate() {
            if ci > 0 {
                out.push(CELL_SEP);
            }
            out.push_str(cell);
        }
    }
    out
}

/// Header plus body, the shape `run_query_packed` returns. An empty column
/// list packs to an empty string, which the frontend reads as "no result set".
pub fn pack_result(columns: &[String], rows: &[Vec<String>]) -> String {
    if columns.is_empty() {
        return String::new();
    }
    let header = join_sep(columns, CELL_SEP);
    let body = pack_rows_vec(rows);
    if body.is_empty() {
        return header;
    }
    let mut s = String::with_capacity(header.len() + 1 + body.len());
    s.push_str(&header);
    s.push(ROW_SEP);
    s.push_str(&body);
    s
}

/// Events emitted while streaming a result set to the frontend.
#[derive(serde::Serialize, Clone)]
#[serde(tag = "type")]
pub enum QueryStreamEvent {
    #[serde(rename = "columns")]
    Columns { columns: String, total_rows: usize },
    #[serde(rename = "chunk")]
    Chunk { data: String },
    #[serde(rename = "done")]
    Done { elapsed: f32, capped: bool },
}

/// Cap on rows handed to the webview, which will OOM long before a server does.
pub const MAX_STREAM_ROWS: usize = 500_000;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_empty_result_set_packs_to_nothing() {
        assert_eq!(pack_result(&[], &[]), "");
    }

    #[test]
    fn columns_without_rows_keep_their_header() {
        let cols = vec!["id".to_string(), "name".to_string()];
        assert_eq!(pack_result(&cols, &[]), format!("id{CELL_SEP}name"));
    }

    #[test]
    fn rows_follow_the_header() {
        let cols = vec!["id".to_string(), "name".to_string()];
        let rows = vec![
            vec!["1".to_string(), "ada".to_string()],
            vec!["2".to_string(), "alan".to_string()],
        ];
        assert_eq!(
            pack_result(&cols, &rows),
            format!("id{CELL_SEP}name{ROW_SEP}1{CELL_SEP}ada{ROW_SEP}2{CELL_SEP}alan")
        );
    }
}

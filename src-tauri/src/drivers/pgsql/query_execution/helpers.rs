use tokio_postgres::SimpleQueryMessage;

pub(crate) use crate::drivers::packing::{join_sep, pack_rows_vec};

/// Process simple_query messages, returning the last result set the query
/// produced — including an empty one, so a SELECT matching no rows still keeps
/// its column headers.
/// If no statement returned a result set but commands ran, returns synthetic
/// "N rows affected". If nothing at all, returns empty vecs.
pub(crate) fn process_simple_messages(
    messages: Vec<SimpleQueryMessage>,
) -> (Vec<String>, Vec<Vec<String>>) {
    let mut cur_columns: Vec<String> = Vec::new();
    let mut cur_rows: Vec<Vec<String>> = Vec::new();
    let mut cur_is_row_set = false;
    let mut last_columns: Vec<String> = Vec::new();
    let mut last_rows: Vec<Vec<String>> = Vec::new();
    let mut has_row_result = false;
    let mut total_affected: u64 = 0;

    for msg in messages {
        match msg {
            // Sent ahead of the rows, and on its own when the result set is empty.
            SimpleQueryMessage::RowDescription(columns) => {
                cur_columns = columns.iter().map(|c| c.name().to_owned()).collect();
                cur_is_row_set = true;
            }
            SimpleQueryMessage::Row(row) => {
                let col_count = row.columns().len();
                if cur_columns.is_empty() {
                    cur_columns = Vec::with_capacity(col_count);
                    for c in row.columns() {
                        cur_columns.push(c.name().to_owned());
                    }
                }
                let mut cells = Vec::with_capacity(col_count);
                for i in 0..col_count {
                    cells.push(row.get(i).unwrap_or("null").to_owned());
                }
                cur_rows.push(cells);
            }
            SimpleQueryMessage::CommandComplete(n) => {
                if cur_is_row_set || !cur_rows.is_empty() {
                    last_columns = std::mem::take(&mut cur_columns);
                    last_rows = std::mem::take(&mut cur_rows);
                    has_row_result = true;
                } else {
                    cur_columns.clear();
                    cur_rows.clear();
                }
                cur_is_row_set = false;
                total_affected += n;
            }
            _ => {}
        }
    }

    // Handle trailing rows (shouldn't happen but be safe)
    if !cur_rows.is_empty() {
        return (cur_columns, cur_rows);
    }

    if has_row_result {
        (last_columns, last_rows)
    } else if total_affected > 0 {
        (
            vec!["Result".into()],
            vec![vec![format!("{} rows affected", total_affected)]],
        )
    } else {
        (Vec::new(), Vec::new())
    }
}

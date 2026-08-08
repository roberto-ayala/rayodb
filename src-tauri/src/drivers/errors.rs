//! Turning driver failures into something a person can act on.
//!
//! A connection error arrives wrapped in whatever the pool and the driver put
//! around it — "Error occurred while creating a new object: error connecting to
//! server: error connecting to server: Connection refused (os error 61)". Every
//! word of that is true and none of it says what to do. The fact worth showing
//! is the innermost one, phrased against what the user typed.

use std::error::Error;
use std::io;

/// Walk to the innermost `io::Error`, which is where a network failure ends up
/// however many layers wrapped it.
fn root_io_error<'a>(e: &'a (dyn Error + 'static)) -> Option<&'a io::Error> {
    let mut current: Option<&(dyn Error + 'static)> = Some(e);
    let mut found = None;
    while let Some(err) = current {
        if let Some(io_err) = err.downcast_ref::<io::Error>() {
            found = Some(io_err);
        }
        current = err.source();
    }
    found
}

/// A network failure, said plainly, or `None` if this is not one.
pub fn explain_network(host: &str, port: &str, e: &(dyn Error + 'static)) -> Option<String> {
    let io_err = root_io_error(e)?;
    let target = format!("{host}:{port}");

    Some(match io_err.kind() {
        io::ErrorKind::ConnectionRefused => format!(
            "Nothing is listening on {target}. The server may be stopped, or on a \
             different port."
        ),
        io::ErrorKind::TimedOut => format!(
            "{target} did not answer in time. A firewall may be dropping the \
             connection, or the host may be unreachable."
        ),
        io::ErrorKind::HostUnreachable | io::ErrorKind::NetworkUnreachable => {
            format!("No route to {host}.")
        }
        io::ErrorKind::ConnectionReset => {
            format!("{target} closed the connection. It may require SSL.")
        }
        io::ErrorKind::NotFound => format!("The host {host} could not be resolved."),
        _ => {
            // Not a shape worth rewriting, but still worth stripping the
            // wrappers off.
            let msg = io_err.to_string();
            if msg.trim().is_empty() {
                return None;
            }
            format!("Could not reach {target}: {msg}")
        }
    })
}

/// Collapse an error chain into one line, dropping the repeats wrappers leave
/// behind — "error connecting to server: error connecting to server: …".
pub fn error_chain(e: &(dyn Error + 'static)) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut current: Option<&(dyn Error + 'static)> = Some(e);

    while let Some(err) = current {
        let msg = err.to_string();
        // Each layer usually restates its source, so keep only what is new.
        if !parts.iter().any(|p: &String| p == &msg || p.contains(&msg)) {
            parts.push(msg);
        }
        current = err.source();
    }

    // Wrappers that say nothing about the failure itself.
    const NOISE: [&str; 2] = [
        "Error occurred while creating a new object",
        "Backend error",
    ];
    parts.retain(|p| !NOISE.iter().any(|n| p.starts_with(n)));

    if parts.is_empty() {
        return e.to_string();
    }
    parts.join(": ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug)]
    struct Wrapper(String, Option<Box<dyn Error + Send + Sync>>);

    impl std::fmt::Display for Wrapper {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str(&self.0)
        }
    }

    impl Error for Wrapper {
        fn source(&self) -> Option<&(dyn Error + 'static)> {
            self.1
                .as_ref()
                .map(|e| e.as_ref() as &(dyn Error + 'static))
        }
    }

    fn refused() -> Wrapper {
        // The shape deadpool + tokio-postgres actually produce.
        Wrapper(
            "Error occurred while creating a new object".into(),
            Some(Box::new(Wrapper(
                "error connecting to server".into(),
                Some(Box::new(Wrapper(
                    "error connecting to server".into(),
                    Some(Box::new(io::Error::from(io::ErrorKind::ConnectionRefused))),
                ))),
            ))),
        )
    }

    #[test]
    fn a_refused_connection_names_the_address() {
        let msg = explain_network("localhost", "5432", &refused()).expect("network error");
        assert!(msg.contains("localhost:5432"), "{msg}");
        assert!(msg.contains("Nothing is listening"), "{msg}");
        // The pool's wrapper has no business here.
        assert!(!msg.contains("creating a new object"), "{msg}");
    }

    #[test]
    fn a_timeout_suggests_what_to_look_at() {
        let e = Wrapper(
            "connect".into(),
            Some(Box::new(io::Error::from(io::ErrorKind::TimedOut))),
        );
        let msg = explain_network("db.internal", "5432", &e).expect("network error");
        assert!(msg.contains("did not answer in time"), "{msg}");
    }

    #[test]
    fn a_non_network_failure_is_left_alone() {
        let e = Wrapper("password authentication failed".into(), None);
        assert!(explain_network("localhost", "5432", &e).is_none());
    }

    #[test]
    fn the_chain_drops_repeats_and_wrappers() {
        let chained = error_chain(&refused());
        assert!(!chained.contains("creating a new object"), "{chained}");
        assert_eq!(
            chained.matches("error connecting to server").count(),
            1,
            "the repeat should be collapsed: {chained}"
        );
        assert!(chained.contains("refused"), "{chained}");
    }
}

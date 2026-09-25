//! Native capture host diagnostics. Suspended verification creates a contained
//! process but never resumes it. The pipe self-test runs only native OS sort.
//! `--protocol-stdio` accepts one bounded, versioned diagnostic launch batch and
//! returns one JSON result; the product launch lane and provider adapters remain
//! separate and are not exposed as an agent endpoint here.
//! `--protocol-framed` returns bounded output events and a strict completion frame.
//! `--protocol-duplex` retains bound cancellation control after validated input.
//! `--self-test-host` checks the real contained parent/host boundary on Windows.
#[cfg(any(windows, test))]
use projecta_capture::protocol;
#[cfg(windows)]
use projecta_capture::{windows_image, windows_process};

fn main() {
    if let Err(error) = run() {
        eprintln!("capture host: {error}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    #[cfg(windows)]
    if args.len() == 1 && args[0] == "--verify-native-resources" {
        // Same compiled trust and bounded loader as the app. No key, path or
        // build-identity override is accepted by this packaging gate.
        let loaded = projecta_capture::native_resources::files::load_for_current_app()?;
        let own_path = std::env::current_exe().map_err(|_| "host path unavailable")?;
        let own_image =
            windows_image::VerifiedImage::open(&own_path, loaded.authorization().host_sha256())?;
        println!(
            "{}",
            serde_json::json!({
                "schemaVersion": 1,
                "state": "signed_host_resources_verified",
                "hostSha256": own_image.identity().sha256,
                "manifestSha256": loaded.authorization().manifest_sha256(),
                "installedAcceptance": false
            })
        );
        return Ok(());
    }
    #[cfg(windows)]
    if args.len() == 1 && args[0] == "--fixture-long-running" {
        std::thread::sleep(std::time::Duration::from_secs(31));
        println!("long-running-complete");
        return Ok(());
    }
    #[cfg(windows)]
    if args.len() == 1 && args[0] == "--fixture-live-output" {
        use std::io::Write;
        std::io::stdout()
            .write_all(b"live-ready\n")
            .map_err(|e| e.to_string())?;
        std::io::stdout().flush().map_err(|e| e.to_string())?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(8);
        while std::time::Instant::now() < deadline {
            if std::fs::read("capture-ack.txt").is_ok_and(|bytes| bytes == b"observed") {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        return Err("live parent acknowledgement missing".into());
    }
    #[cfg(windows)]
    if args.len() == 1 && args[0] == "--fixture-blocked-input" {
        // Explicit bounded native fixture for --self-test-host. create_new
        // prevents overwriting any existing file even if invoked manually.
        use std::io::Write;
        let mut marker = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open("capture-ready.txt")
            .map_err(|error| error.to_string())?;
        marker
            .write_all(b"ready")
            .map_err(|error| error.to_string())?;
        marker.sync_all().map_err(|error| error.to_string())?;
        drop(marker);
        std::thread::sleep(std::time::Duration::from_secs(60));
        return Ok(());
    }
    #[cfg(windows)]
    if args.len() == 1 && args[0] == "--self-test-host" {
        println!("{}", windows_process::self_test_host()?);
        return Ok(());
    }
    #[cfg(windows)]
    if args.len() == 1 && args[0] == "--protocol-duplex" {
        return windows_process::execute_protocol_duplex();
    }
    #[cfg(windows)]
    if args.len() == 1 && (args[0] == "--protocol-stdio" || args[0] == "--protocol-framed") {
        use std::io::Read;
        let maximum = protocol::MAX_CONTROL_BYTES;
        let mut control = Vec::new();
        std::io::stdin()
            .take((maximum + 1) as u64)
            .read_to_end(&mut control)
            .map_err(|error| format!("read capture protocol: {error}"))?;
        if control.len() > maximum {
            return Err("capture protocol input exceeded limit".into());
        }
        let prepared = protocol::prepare_buffer(&control)?;
        if args[0] == "--protocol-framed" {
            return windows_process::execute_protocol_framed(prepared);
        }
        let result = windows_process::execute_protocol(prepared)?;
        println!(
            "{}",
            serde_json::to_string(&result).map_err(|error| error.to_string())?
        );
        return Ok(());
    }
    #[cfg(windows)]
    if args.len() == 1 && args[0] == "--self-test-pipes" {
        println!("{}", windows_process::self_test()?);
        return Ok(());
    }
    if args.len() != 3 || (args[0] != "--verify-image" && args[0] != "--verify-suspended-image") {
        // Explicit stand-in for a provider that reads its task input and then
        // rejects the invocation. The native worker tests copy this host as a
        // fake provider; without draining, input delivery only succeeded while
        // the task input fit into the anonymous pipe buffer. The rejection
        // itself is unchanged, and no recognized mode ever drains.
        #[cfg(windows)]
        if std::env::var_os("PA_CAPTURE_FIXTURE_MODE")
            .is_some_and(|mode| mode == "consume-input-then-reject")
        {
            use std::io::Read;
            std::io::copy(
                &mut std::io::stdin().take(protocol::MAX_INPUT as u64),
                &mut std::io::sink(),
            )
            .map_err(|error| format!("read fixture input: {error}"))?;
        }
        return Err("usage: pa-capture-host --verify-image|--verify-suspended-image <absolute-exe> <sha256>; provider execution unavailable".into());
    }
    #[cfg(windows)]
    {
        let digest = args[2].to_str().ok_or("invalid digest encoding")?;
        if args[0] == "--verify-suspended-image" {
            let observation = windows_process::verify(std::path::Path::new(&args[1]), digest)?;
            println!(
                "{}",
                serde_json::to_string(&observation).map_err(|e| e.to_string())?
            );
            return Ok(());
        }
        let image = windows_image::VerifiedImage::open(std::path::Path::new(&args[1]), digest)?;
        println!(
            "{}",
            serde_json::to_string(image.identity()).map_err(|e| e.to_string())?
        );
        Ok(())
    }
    #[cfg(not(windows))]
    Err("native executable verification is not implemented on this platform".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn protocol_stdio_input_limit_is_enforced_before_parsing() {
        let oversized = vec![0u8; super::protocol::MAX_CONTROL_BYTES + 1];
        assert!(matches!(
            super::protocol::prepare_buffer(&oversized),
            Err("capture control batch exceeded limit")
        ));
    }
}

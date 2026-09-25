# Native resource signature fixtures

native-resources.json contains a public test key and exact signed message
strings. The ephemeral private key was deleted after generation. These fixtures
cannot authorize production resources: the public app entry uses the embedded
updater key instead.

Generated with Tauri CLI2.11.4 signer generate --ci --write-keys, then signer
sign --password '' --private-key-path for each UTF-8 message. Calling the CLI
through node preserves the empty password argument on Windows. Tests first
verify every signature, including the intentionally invalid signed manifests,
then exercise the manifest contract.

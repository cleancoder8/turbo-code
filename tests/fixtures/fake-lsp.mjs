let buffer = Buffer.alloc(0);
let opened;
function send(message) {
  const body = Buffer.from(JSON.stringify(message));
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, end).toString())?.[1]);
    if (buffer.length < end + 4 + length) return;
    const msg = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    if (msg.method === "initialize") send({ jsonrpc: "2.0", id: msg.id, result: { capabilities: { textDocumentSync: 1 } } });
    if (msg.method === "shutdown") send({ jsonrpc: "2.0", id: msg.id, result: null });
    if (msg.method === "exit") process.exit(0);
    if (msg.method === "textDocument/didOpen") {
      opened = msg.params.textDocument.uri;
      send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
        uri: opened, version: 1, diagnostics: [{ severity: 1 }, { severity: 2 }],
      } });
    }
    if (msg.method === "textDocument/didChange") send({ jsonrpc: "2.0", method: "textDocument/publishDiagnostics", params: {
      uri: opened, version: msg.params.textDocument.version, diagnostics: [],
    } });
  }
});

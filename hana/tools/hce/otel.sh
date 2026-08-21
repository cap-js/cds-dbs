#!/bin/bash

TRACE_DIR="/hana/mounts/trace/hana/DB_H00"
OTEL_ENDPOINT="http://jaeger:4318/v1/traces"

process_trace_file() {
  local trace_file="$1"
  # All 64-bit ns timestamps and ids are handled as decimal strings via addstr()
  # so we do not need gawk's MPFR (-M) build (the HANA container image ships an
  # awk without GMP). OFMT/CONVFMT keep any incidental numeric prints integer.
  tail -F "$trace_file" | awk -v RS='\n\n' -v OFMT='%.0f' -v CONVFMT='%.0f' '
  function rand_hex(n,   i, s, c) {
    s = ""
    for (i = 0; i < n; i++) {
      c = int(rand() * 16)
      s = s sprintf("%x", c)
    }
    return s
  }
  function clean_hex(v, n) {
    # keep only hex chars, lowercase, truncate/pad to n chars
    gsub(/[^0-9A-Fa-f]/, "", v)
    v = tolower(v)
    while (length(v) < n) v = "0" v
    return substr(v, length(v) - n + 1)
  }
  function json_escape(s) {
    gsub(/\\/, "\\\\", s)
    gsub(/"/,  "\\\"", s)
    gsub(/\t/, "\\t",  s)
    gsub(/\r/, "\\r",  s)
    gsub(/\n/, "\\n",  s)
    # strip remaining control chars (< 0x20) we did not handle explicitly
    gsub(/[\001-\010\013\014\016-\037]/, " ", s)
    return s
  }
  # Add two non-negative integer strings without going through double
  # precision floats, which lose precision around 2^53 (~ year 2255 in
  # millisecond epoch, but already today when we work in nanoseconds).
  function addstr(a, b,   la, lb, i, da, db, c, sum, out) {
    gsub(/[^0-9]/, "", a); gsub(/[^0-9]/, "", b)
    if (a == "") a = "0"; if (b == "") b = "0"
    la = length(a); lb = length(b); c = 0; out = ""
    for (i = 1; i <= la || i <= lb || c; i++) {
      da = (i <= la) ? substr(a, la - i + 1, 1) + 0 : 0
      db = (i <= lb) ? substr(b, lb - i + 1, 1) + 0 : 0
      sum = da + db + c
      c = int(sum / 10)
      out = (sum % 10) out
    }
    return out
  }
  BEGIN { srand() }
  {
    # Extract the SQL statement (the line starting with "#" inside the record).
    # The SQL is NOT in any semicolon-separated field; HANA writes it after the
    # data line, prefixed with "#" on every continuation line.
    stmt = $0
    if (match(stmt, /(^|\n)#[^\0]*/)) {
      statementString = substr(stmt, RSTART, RLENGTH)
      gsub(/(^|\n)#/, " ", statementString)
    } else {
      statementString = ""
    }

    split($0, fields, ";")
    # Field layout (1-indexed) of HANA expensive_statements trace records:
    #   6   start time (microseconds since epoch)
    #   7   duration (microseconds)
    #   9   operation (SELECT/INSERT/COMPILE/...)
    #  19   memory size
    #  21   cpu time
    #  22   W3C trace id  (16 bytes / 32 hex chars), propagated via SAP_PASSPORT
    #  24   SAP passport span id (16 bytes / 32 hex chars);
    #       last 16 hex chars = the W3C span id of the CALLING span emitted by
    #       @cap-js/telemetry. We make our HANA-side span a child of it.
    #  30   statement hash (same for every execution of the same SQL)
    operation      = fields[9]
    traceId        = clean_hex(fields[22], 32)
    # The calling (parent) span id is the last 16 hex chars of field 24.
    parentSpanId   = clean_hex(substr(fields[24], 17), 16)
    # Always emit a fresh random span id so we do not collide with the span
    # @cap-js/telemetry has already exported under the same trace id.
    spanId         = rand_hex(16)
    startTime      = fields[6] "000"
    duration       = fields[7] "000"
    endTime        = addstr(startTime, duration)
    statementHash  = json_escape(fields[30])
    memSize        = fields[19] + 0
    cpuTime        = fields[21] + 0

    # The span name should describe what happened: use the SQL statement
    # (truncated so Jaeger UI stays readable) and fall back to the operation.
    spanName = statementString
    gsub(/[\r\n\t]+/, " ", spanName)
    sub(/^ +/, "", spanName)
    if (length(spanName) > 120) spanName = substr(spanName, 1, 117) "..."
    if (spanName == "") spanName = operation
    if (operation == "COMPILE") spanName = "COMPILE: " spanName
    operation       = json_escape(operation)
    spanName        = json_escape(spanName)
    statementString = json_escape(statementString)

    # Skip spans without a valid (non-zero) trace id; OTLP receivers drop them.
    # An all-zero trace id means SAP_PASSPORT propagation was not active for
    # this connection (e.g. internal HANA work or a non-instrumented client).
    if (traceId == "00000000000000000000000000000000") next

    printf "{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"@sap/hana-cloud\"}}]},\"scopeSpans\":[{\"scope\":{\"name\":\"@cap-js/hana\",\"version\":\"0.0.0\"},\"spans\":[{\"traceId\":\"%s\",\"spanId\":\"%s\",\"parentSpanId\":\"%s\",\"name\":\"%s\",\"kind\":2,\"startTimeUnixNano\":\"%s\",\"endTimeUnixNano\":\"%s\",\"attributes\":[{\"key\":\"db.statement\",\"value\":{\"stringValue\":\"%s\"}},{\"key\":\"db.operation\",\"value\":{\"stringValue\":\"%s\"}},{\"key\":\"db.statement.hash\",\"value\":{\"stringValue\":\"%s\"}},{\"key\":\"db.mem_size\",\"value\":{\"intValue\":\"%d\"}},{\"key\":\"db.cpu_time\",\"value\":{\"intValue\":\"%d\"}}]}]}]}]}\n",
      traceId, spanId, parentSpanId, spanName, startTime, endTime, statementString, operation, statementHash, memSize, cpuTime
  }' | while IFS= read -r payload; do
    curl --silent --show-error --fail \
      -X POST "$OTEL_ENDPOINT" \
      -H "Content-Type: application/json" \
      --data-binary "$payload" \
      || echo "otel: dropped span" >&2
  done
}

cleanup() {
  pkill -P $$
  exit 0
}
trap cleanup SIGINT SIGTERM

declare -A processed_files
while true; do
  for trace_file in "$TRACE_DIR"/*.expensive_statements.*.trc; do
    if [ -f "$trace_file" ] && [ -z "${processed_files[$trace_file]:-}" ]; then
      echo "Listening to $trace_file..."
      process_trace_file "$trace_file" &
      processed_files["$trace_file"]=1
    fi
  done
  sleep 10
done

#!/bin/bash

# Directory containing the trace files
TRACE_DIR="/hana/mounts/trace/hana/DB_H00"

# OpenTelemetry endpoint
OTEL_ENDPOINT="http://jaeger:4318/v1/traces"

# Function to process a trace file
process_trace_file() {
  local trace_file="$1"
  tail -F "$trace_file" | awk -v RS='\n\n' 'function generate_span_id() {
    cmd = "cat /proc/sys/kernel/random/uuid | tr -d \"-\" | cut -c1-16 | tr -d \"\n\""
    cmd | getline span_id
    close(cmd)
    return span_id
  }
  {
    split($0, fields, ";");
    traceId=fields[22];
    spanId=generate_span_id();
    parentSpanId=substr(fields[24], 17);
    startTime=fields[6] "000";  # Convert to nanoseconds
    duration=fields[7] "000";   # Convert to nanoseconds
    endTime=startTime + duration;
    operation=fields[9];
    statementString=fields[54];
    memSize=fields[19];
    cpuTime=fields[21];
    gsub(/^#/, "", statementString);
    gsub(/\n/, " ", statementString);
    gsub(/"/, "\\\"", statementString);
    
    # Prepare the JSON payload according to OpenTelemetry API structure
    print sprintf("{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"@sap/hana-cloud\"}}]},\"scopeSpans\":[{\"spans\":[{\"traceId\":\"%s\",\"spanId\":\"%s\",\"parentSpanId\":\"%s\",\"name\":\"%s\",\"kind\":2,\"startTimeUnixNano\":\"%s\",\"endTimeUnixNano\":\"%s\",\"attributes\":[{\"key\":\"db.statement\",\"value\":{\"stringValue\":\"%s\"}},{\"key\":\"db.operation\",\"value\":{\"stringValue\":\"%s\"}},{\"key\":\"db.mem_size\",\"value\":{\"intValue\":%s}},{\"key\":\"db.cpu_time\",\"value\":{\"intValue\":%s}}]}]}]}]}", traceId, spanId, parentSpanId, operation, startTime, endTime, statementString, operation, memSize, cpuTime);
  }' | while read -r json_payload; do
    echo "$json_payload"
    echo "$json_payload" | curl -X POST "$OTEL_ENDPOINT" -H "Content-Type: application/json" -d @-
  done
}

# Function to handle script termination
cleanup() {
  echo "Cleaning up..."
  pkill -P $$
  exit 0
}

# Trap signals to ensure cleanup
trap cleanup SIGINT SIGTERM

# Monitor the directory for new trace files and changes
declare -A processed_files

while true; do
  for trace_file in "$TRACE_DIR"/*.expensive_statements.*.trc; do
    if [ -f "$trace_file" ] && [ -z "${processed_files[$trace_file]}" ]; then
      echo "Listening to $trace_file..."
      process_trace_file "$trace_file" &
      processed_files["$trace_file"]=1
    fi
  done
  sleep 10
done

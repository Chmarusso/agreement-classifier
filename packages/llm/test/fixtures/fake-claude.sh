#!/bin/sh
# Stand-in for the claude CLI. FAKE_CLAUDE_SCENARIO picks the behaviour.
cat > /dev/null
case "$FAKE_CLAUDE_SCENARIO" in
  valid) echo '{"type":"result","subtype":"success","is_error":false,"result":"{}","structured_output":{"ok":true},"total_cost_usd":0.0123,"duration_ms":1500,"num_turns":2,"session_id":"s-1","usage":{"input_tokens":10,"cache_creation_input_tokens":1000,"cache_read_input_tokens":0,"output_tokens":50},"modelUsage":{"claude-opus-5":{}}}' ;;
  not_logged_in) echo '{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","total_cost_usd":0}'; exit 1 ;;
  no_structured) echo '{"type":"result","subtype":"success","is_error":false,"result":"Here is my answer in prose.","total_cost_usd":0.002}' ;;
  garbage) echo 'Traceback: something broke' >&2; exit 2 ;;
  slow) sleep 5; echo '{}' ;;
esac

#!/usr/bin/env bash
set -u

CONTAINER_NAME="${URL_TO_PNG_CONTAINER:-url-to-png}"
PING_URL="${URL_TO_PNG_PING_URL:-http://127.0.0.1:3089/ping}"
SCREENSHOT_URL="${URL_TO_PNG_SCREENSHOT_URL:-http://127.0.0.1:3089/?url=https%3A%2F%2Fexample.com&isFullPage=true&width=1080&height=1080&viewportWidth=1080&viewportHeight=1080&isMobile=false&isDarkMode=false&forceReload=true}"
LOG_FILE="${URL_TO_PNG_WATCHDOG_LOG:-/var/log/url-to-png-watchdog.log}"
STATE_FILE="${URL_TO_PNG_WATCHDOG_STATE:-/var/run/url-to-png-watchdog.failures}"
LOCK_FILE="${URL_TO_PNG_WATCHDOG_LOCK:-/var/run/url-to-png-watchdog.lock}"
FAILURE_THRESHOLD="${URL_TO_PNG_WATCHDOG_FAILURE_THRESHOLD:-2}"
MIN_IMAGE_BYTES="${URL_TO_PNG_WATCHDOG_MIN_IMAGE_BYTES:-1000}"
CURL_TIMEOUT="${URL_TO_PNG_WATCHDOG_CURL_TIMEOUT:-35}"

timestamp() {
  date '+%Y-%m-%d %H:%M:%S %z'
}

log() {
  printf '%s %s\n' "$(timestamp)" "$*" >>"${LOG_FILE}"
}

read_failures() {
  if [[ -f "${STATE_FILE}" ]]; then
    cat "${STATE_FILE}" 2>/dev/null || printf '0'
  else
    printf '0'
  fi
}

write_failures() {
  printf '%s\n' "$1" >"${STATE_FILE}"
}

record_failure() {
  local reason="$1"
  local failures
  failures="$(read_failures)"
  if ! [[ "${failures}" =~ ^[0-9]+$ ]]; then
    failures=0
  fi
  failures=$((failures + 1))
  write_failures "${failures}"
  log "status=fail failures=${failures} reason=${reason}"

  docker ps --filter "name=${CONTAINER_NAME}" --format 'container={{.Names}} status={{.Status}} ports={{.Ports}}' >>"${LOG_FILE}" 2>&1 || true
  docker logs --tail 30 "${CONTAINER_NAME}" >>"${LOG_FILE}" 2>&1 || true

  if (( failures >= FAILURE_THRESHOLD )); then
    log "action=restart container=${CONTAINER_NAME} threshold=${FAILURE_THRESHOLD}"
    if docker restart "${CONTAINER_NAME}" >>"${LOG_FILE}" 2>&1; then
      write_failures 0
      log "action=restart_result status=success container=${CONTAINER_NAME}"
    else
      log "action=restart_result status=failed container=${CONTAINER_NAME}"
    fi
  fi
}

main() {
  mkdir -p "$(dirname "${LOG_FILE}")" "$(dirname "${STATE_FILE}")" "$(dirname "${LOCK_FILE}")"
  exec 9>"${LOCK_FILE}"
  if ! flock -n 9; then
    log "status=skip reason=lock_busy"
    exit 0
  fi

  if ! docker inspect -f '{{.State.Running}}' "${CONTAINER_NAME}" 2>/dev/null | grep -q '^true$'; then
    record_failure "container_not_running"
    exit 1
  fi

  if ! curl -fsS --max-time 10 "${PING_URL}" >/dev/null; then
    record_failure "ping_failed"
    exit 1
  fi

  local tmp_dir headers body http_code bytes content_type
  tmp_dir="$(mktemp -d)"
  headers="${tmp_dir}/headers"
  body="${tmp_dir}/body"

  http_code="$(curl -sS --max-time "${CURL_TIMEOUT}" -D "${headers}" -o "${body}" -w '%{http_code}' "${SCREENSHOT_URL}" || true)"
  bytes="$(wc -c <"${body}" 2>/dev/null || printf '0')"
  content_type="$(grep -i '^content-type:' "${headers}" 2>/dev/null | tail -1 | tr -d '\r' || true)"

  if [[ "${http_code}" == "200" ]] && [[ "${content_type}" == *"image/png"* ]] && (( bytes >= MIN_IMAGE_BYTES )); then
    write_failures 0
    log "status=ok http_code=${http_code} bytes=${bytes} content_type=${content_type}"
    rm -rf "${tmp_dir}"
    exit 0
  fi

  log "response_body=$(head -c 300 "${body}" 2>/dev/null | tr '\n' ' ')"
  rm -rf "${tmp_dir}"
  record_failure "screenshot_failed http_code=${http_code} bytes=${bytes} content_type=${content_type}"
  exit 1
}

main "$@"

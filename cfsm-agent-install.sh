#!/bin/sh
# cfsm-agent NON-ROOT installer
# Modified for hosting panels / containers where root and systemd are unavailable.
# Installs everything under ~/.cf-probe and runs cf-probe in the current user.
set -eu

REPO="huilang-me/cfsm-agent"
GITHUB_PROXY=""
INSTALL_VERSION="latest"

log() { printf '%s\n' "$*"; }
die() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }

usage() {
    cat <<'EOF'
用法:
  sh install.sh install -id=SERVER_ID -secret=SECRET -url=WORKER_URL [选项]
  sh install.sh start
  sh install.sh stop
  sh install.sh restart
  sh install.sh status
  sh install.sh uninstall

此版本不需要 root，不使用 systemd/system service。
文件全部放在 ~/.cf-probe/
EOF
    exit 1
}

need_value_for=""
for arg in "$@"; do
    if [ -n "$need_value_for" ]; then
        case "$need_value_for" in
            proxy) GITHUB_PROXY="$arg" ;;
            version) INSTALL_VERSION="$arg" ;;
        esac
        need_value_for=""
        continue
    fi
    case "$arg" in
        --install-ghproxy=*) GITHUB_PROXY="${arg#*=}" ;;
        --install-ghproxy) need_value_for="proxy" ;;
        --install-version=*) INSTALL_VERSION="${arg#*=}" ;;
        --install-version) need_value_for="version" ;;
    esac
done

[ -n "${HOME:-}" ] || die "HOME 环境变量不存在，无法进行非 root 安装"

BASE_DIR="${HOME%/}/.cf-probe"
BIN_DIR="$BASE_DIR/bin"
BIN="$BIN_DIR/cf-probe"
CONFIG="$BASE_DIR/config.conf"
LOG_FILE="$BASE_DIR/cf-probe.log"
PID_FILE="$BASE_DIR/cf-probe.pid"
TMP_DIR="$BASE_DIR/tmp"
TRAFFIC_FILE="$BASE_DIR/traffic.dat"

detect_os() {
    os="$(uname -s 2>/dev/null || printf unknown)"
    case "$os" in
        Linux) printf linux ;;
        Darwin) printf darwin ;;
        FreeBSD) printf freebsd ;;
        MINGW*|MSYS*|CYGWIN*) printf windows ;;
        *) die "unsupported OS: $os" ;;
    esac
}

detect_arch() {
    arch="$(uname -m 2>/dev/null || printf unknown)"
    case "$arch" in
        x86_64|amd64) printf amd64 ;;
        aarch64|arm64) printf arm64 ;;
        i386|i686) printf 386 ;;
        armv5*) printf armv5 ;;
        armv6*) printf armv6 ;;
        armv7*|armv8l) printf armv7 ;;
        loongarch64|loong64) printf loong64 ;;
        *) die "unsupported architecture: $arch" ;;
    esac
}

download() {
    url="$1"
    out="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fL --connect-timeout 15 -m 180 -o "$out" "$url"
    elif command -v wget >/dev/null 2>&1; then
        wget -O "$out" "$url"
    else
        die "curl or wget is required"
    fi
}

quote_config() {
    # Config values are written in double quotes. Escape \ and ".
    printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

get_arg() {
    key="$1"
    shift
    for arg in "$@"; do
        case "$arg" in
            "$key"=*) printf '%s' "${arg#*=}"; return 0 ;;
        esac
    done
    return 1
}

is_running() {
    [ -f "$PID_FILE" ] || return 1
    pid="$(cat "$PID_FILE" 2>/dev/null || true)"
    case "$pid" in
        ''|*[!0-9]*) return 1 ;;
    esac
    kill -0 "$pid" 2>/dev/null
}

stop_agent() {
    if [ -f "$PID_FILE" ]; then
        pid="$(cat "$PID_FILE" 2>/dev/null || true)"
        case "$pid" in
            ''|*[!0-9]*) pid="" ;;
        esac
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            log "[INFO] stopping cf-probe pid=$pid"
            kill "$pid" 2>/dev/null || true
            i=0
            while [ "$i" -lt 10 ]; do
                kill -0 "$pid" 2>/dev/null || break
                sleep 1
                i=$((i + 1))
            done
            if kill -0 "$pid" 2>/dev/null; then
                kill -9 "$pid" 2>/dev/null || true
            fi
        fi
        rm -f "$PID_FILE"
    fi
}

start_agent() {
    [ -x "$BIN" ] || die "cf-probe binary not installed: $BIN"
    [ -f "$CONFIG" ] || die "config not found: $CONFIG"

    if is_running; then
        log "[INFO] cf-probe already running (pid=$(cat "$PID_FILE"))"
        return 0
    fi

    mkdir -p "$BASE_DIR" "$TMP_DIR"
    rm -f "$PID_FILE"

    log "[INFO] starting cf-probe without root..."
    nohup "$BIN" run -config "$CONFIG" >>"$LOG_FILE" 2>&1 </dev/null &
    pid=$!
    printf '%s\n' "$pid" > "$PID_FILE"

    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        log "[OK] cf-probe started, pid=$pid"
        log "[INFO] log: $LOG_FILE"
    else
        rm -f "$PID_FILE"
        log "[ERROR] cf-probe failed to start. Last log:"
        tail -n 50 "$LOG_FILE" 2>/dev/null || true
        return 1
    fi
}

status_agent() {
    if is_running; then
        log "[OK] cf-probe is running (pid=$(cat "$PID_FILE"))"
        log "[INFO] config: $CONFIG"
        log "[INFO] log:    $LOG_FILE"
        return 0
    fi
    log "[INFO] cf-probe is not running"
    [ -f "$LOG_FILE" ] && {
        log "[INFO] last log:"
        tail -n 20 "$LOG_FILE" || true
    }
    return 1
}

uninstall_agent() {
    stop_agent || true
    rm -rf "$BASE_DIR"
    log "[OK] removed $BASE_DIR"
}

install_agent() {
    os_name="$(detect_os)"
    arch_name="$(detect_arch)"

    case "$os_name" in
        windows)
            die "Windows is not supported by this non-root shell installer"
            ;;
    esac

    asset="cf-probe-${os_name}-${arch_name}"
    if [ "$INSTALL_VERSION" = "latest" ]; then
        path="latest/download"
    else
        path="download/$INSTALL_VERSION"
    fi

    url="https://github.com/$REPO/releases/$path/$asset"
    if [ -n "$GITHUB_PROXY" ]; then
        url="${GITHUB_PROXY%/}/$url"
    fi

    SERVER_ID="$(get_arg -id "$@" || true)"
    SECRET="$(get_arg -secret "$@" || true)"
    WORKER_URL="$(get_arg -url "$@" || true)"

    # These are the parameters from your original command.
    COLLECT_INTERVAL="$(get_arg -collect_interval "$@" || printf '0')"
    REPORT_INTERVAL="$(get_arg -interval "$@" || printf '60')"
    CONNECTION_MODE="$(get_arg -connection_mode "$@" || printf 'auto')"
    PING_MODE="$(get_arg -ping_mode "$@" || printf 'tcp')"
    RESET_DAY="$(get_arg -reset_day "$@" || printf '1')"
    AUTO_UPDATE="$(get_arg -auto_update "$@" || printf '0')"
    CT_NODE="$(get_arg -ct "$@" || true)"
    CU_NODE="$(get_arg -cu "$@" || true)"
    CM_NODE="$(get_arg -cm "$@" || true)"
    BD_NODE="$(get_arg -bd "$@" || true)"
    INTERFACE="$(get_arg -interface "$@" || true)"

    [ -n "$SERVER_ID" ] || die "missing -id=SERVER_ID"
    [ -n "$SECRET" ] || die "missing -secret=SECRET"
    [ -n "$WORKER_URL" ] || die "missing -url=WORKER_URL"

    mkdir -p "$BIN_DIR" "$TMP_DIR"
    chmod 700 "$BASE_DIR" "$BIN_DIR" "$TMP_DIR" 2>/dev/null || true

    tmp="$TMP_DIR/cf-probe.$$"
    trap 'rm -f "$tmp"' EXIT INT TERM

    log "CFSM non-root installer"
    log "  target  : $os_name/$arch_name"
    log "  binary  : $BIN"
    log "  config  : $CONFIG"
    log "  url     : $WORKER_URL"

    # If the binary already exists, only download when it is absent.
    if [ ! -x "$BIN" ]; then
        log "[INFO] downloading $asset ..."
        download "$url" "$tmp"
        chmod +x "$tmp"
        mv "$tmp" "$BIN"
        chmod 700 "$BIN" 2>/dev/null || true
    else
        log "[INFO] existing binary found, keeping it"
    fi

    # Stop our previous user-owned process before replacing/updating config.
    stop_agent || true

    umask 077
    cat > "$CONFIG" <<EOF
SERVER_ID="$(quote_config "$SERVER_ID")"
SECRET="$(quote_config "$SECRET")"
WORKER_URL="$(quote_config "$WORKER_URL")"
COLLECT_INTERVAL="$(quote_config "$COLLECT_INTERVAL")"
REPORT_INTERVAL="$(quote_config "$REPORT_INTERVAL")"
CT_NODE="$(quote_config "$CT_NODE")"
CU_NODE="$(quote_config "$CU_NODE")"
CM_NODE="$(quote_config "$CM_NODE")"
BD_NODE="$(quote_config "$BD_NODE")"
INTERFACE="$(quote_config "$INTERFACE")"
RESET_DAY="$(quote_config "$RESET_DAY")"
AUTO_UPDATE="$(quote_config "$AUTO_UPDATE")"
CONNECTION_MODE="$(quote_config "$CONNECTION_MODE")"
PING_MODE="$(quote_config "$PING_MODE")"
CONFIG_MD5="none"
TRAFFIC_DATA_FILE="$(quote_config "$TRAFFIC_FILE")"
EOF
    chmod 600 "$CONFIG"

    # The upstream agent's normal `install` command tries to register a
    # system/root service in environments without systemd --user. We do NOT
    # call `cf-probe install`; instead we run its documented foreground mode
    # and supervise it with this user-owned PID file.
    start_agent

    log "[OK] non-root installation complete"
    log "[INFO] status : sh \"$0\" status"
    log "[INFO] stop   : sh \"$0\" stop"
    log "[INFO] log    : tail -f \"$LOG_FILE\""
}

cmd="${1:-install}"
shift || true

case "$cmd" in
    install)
        install_agent "$@"
        ;;
    start)
        start_agent
        ;;
    stop)
        stop_agent
        log "[OK] stopped"
        ;;
    restart)
        stop_agent
        start_agent
        ;;
    status)
        status_agent
        ;;
    uninstall|remove|delete|purge)
        uninstall_agent
        ;;
    help|-h|--help)
        usage
        ;;
    *)
        die "unknown command: $cmd"
        ;;
esac

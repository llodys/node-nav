#!/bin/sh
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
WHITE='\033[1;37m'
RESET='\033[0m'
TMP_FILE="/tmp/install_payload_$$"
trap 'rm -f "$TMP_FILE"' EXIT

if [ "$(id -u)" -ne 0 ]; then
    printf "${RED}错误：此脚本必须以 root 用户身份运行。\n${RESET}" >&2
    exit 1
fi

OS_FAMILY=""
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID=$(printf "%s" "$ID" | tr '[:upper:]' '[:lower:]')
    ID_LIKE=$(printf "%s" "$ID_LIKE" | tr '[:upper:]' '[:lower:]')
    
    if printf "%s" "$ID_LIKE" | grep -q "debian" || [ "$OS_ID" = "debian" ] || [ "$OS_ID" = "ubuntu" ]; then
        OS_FAMILY="debian"
    elif printf "%s" "$ID_LIKE" | grep -q "rhel" || printf "%s" "$ID_LIKE" | grep -q "centos" || [ "$OS_ID" = "centos" ] || [ "$OS_ID" = "rhel" ] || [ "$OS_ID" = "fedora" ] || [ "$OS_ID" = "almalinux" ] || [ "$OS_ID" = "rocky" ]; then
        OS_FAMILY="rhel"
    elif [ "$OS_ID" = "alpine" ]; then
        OS_FAMILY="alpine"
    fi
fi

if [ -z "$OS_FAMILY" ]; then
    printf "${RED}错误：无法确定操作系统类型，或不支持此系统。\n${RESET}" >&2; exit 1;
fi

ensure_packages() {
    for pkg in "$@"; do
        if ! command -v "$pkg" >/dev/null 2>&1; then
            printf "${YELLOW}--> 未找到命令 '$pkg'，正在尝试自动安装...${RESET}\n"
            case "$OS_FAMILY" in
                debian) 
                    apt-get update -qq >/dev/null 2>&1 
                    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$pkg" 
                    ;;
                rhel) 
                    if command -v dnf >/dev/null 2>&1; then dnf install -y "$pkg" >/dev/null 2>&1; else yum install -y "$pkg" >/dev/null 2>&1; fi 
                    ;;
                alpine) 
                    apk add --no-cache "$pkg" >/dev/null 2>&1
                    ;;
            esac
            if ! command -v "$pkg" >/dev/null 2>&1; then
                printf "${RED}错误：自动安装 '$pkg' 失败，请手动安装后重试。\n${RESET}" >&2; exit 1;
            else
                printf "${GREEN}--> '$pkg' 安装成功。${RESET}\n";
            fi
        fi
    done
}

case "$OS_FAMILY" in
    alpine) ensure_packages "curl" "bash" ;;
    *)      ensure_packages "curl" ;;
esac

BASE_URL="https://raw.githubusercontent.com/llodys/node-nav/main"
DIRECT_SCRIPT_URL="${BASE_URL}/node-nav.sh"     
ALPINE_DIRECT_URL="${BASE_URL}/node-nav-alpine.sh" 

main() {
    local os_name=$1
    local shell_to_use=$2
    local url=""
    
    clear
    
    if [ "$OS_FAMILY" = "alpine" ]; then
        url="$ALPINE_DIRECT_URL" 
    else
        url="$DIRECT_SCRIPT_URL"  
    fi

    printf "\n--> ${GREEN}检测到系统：${os_name}。开始下载对应的安装脚本...${RESET}\n"
    printf "目标脚本 URL: ${YELLOW}%s${RESET}\n" "$url"
    
    printf "--> 正在下载脚本到 %s ...\n" "$TMP_FILE"
    if ! curl -sSL -f -o "$TMP_FILE" "$url"; then
        printf "${RED}错误：下载脚本失败，请检查 URL 或网络连接。\n${RESET}" >&2
        exit 1
    fi
    
    printf "--> ${GREEN}下载完成，正在启动安装程序...${RESET}\n"
    chmod +x "$TMP_FILE"
    
    "$shell_to_use" "$TMP_FILE"
    
    printf "--> ${GREEN}安装脚本执行结束。${RESET}\n"
}

case "$OS_FAMILY" in
    debian) main "Debian/Ubuntu (Systemd)" "bash" ;;
    rhel)   main "CentOS/RHEL/Fedora (Systemd)" "bash" ;;
    alpine) main "Alpine Linux (OpenRC)" "bash" ;;
esac

exit 0

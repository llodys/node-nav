#!/bin/sh
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
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
  OS_ID=$(echo "$ID" | tr '[:upper:]' '[:lower:]')
  ID_LIKE=$(echo "$ID_LIKE" | tr '[:upper:]' '[:lower:]')
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
            apt-get install -y -qq "$pkg" 
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
    *)       ensure_packages "curl" ;;
esac

BASE_URL="https://raw.githubusercontent.com/llodys/node-nav/main"
DIRECT_SCRIPT_URL="${BASE_URL}/node-nav.sh"        
ALPINE_DIRECT_URL="${BASE_URL}/node-nav-alpine.sh" 
ARGO_SCRIPT_URL="${BASE_URL}/node-nav-argo.sh"
ALPINE_ARGO_URL="${BASE_URL}/node-nav-argo-alpine.sh" 

main() {
    clear
    os_name=$1
    shell_to_use=$2
    url="" 

    echo -e "${CYAN}=================================${RESET}"
    printf "${CYAN} 系统类型 ${RESET}: ${YELLOW}%s${RESET}\n" "$os_name"
    printf "${CYAN} 执行方式 ${RESET}: 使用 ${YELLOW}%s${RESET} 执行\n" "$shell_to_use"
    echo -e "${CYAN}=================================${RESET}"
    printf "请选择安装类型:\n"
    echo -e "${GREEN}1.${RESET} 直接安装"
    echo -e "${GREEN}2.${RESET} Argo安装"
    
    printf "请输入您的选择 (1 或 2): "
    read -r choice_type
    
    case "$choice_type" in
        1|"") 
        printf "--> ${GREEN}已选择：直接安装${RESET}\n"
        if [ "$OS_FAMILY" = "alpine" ]; then
            url="$ALPINE_DIRECT_URL" 
        else
            url="$DIRECT_SCRIPT_URL"  
        fi
        ;;
        2)
        printf "--> ${GREEN}已选择：Argo 安装${RESET}\n"
        if [ "$OS_FAMILY" = "alpine" ]; then
            url="$ALPINE_ARGO_URL"    
        else
            url="$ARGO_SCRIPT_URL"    
        fi
        ;;
        *)
        printf "${RED}错误：无效选择 '$choice_type'。操作已取消。\n${RESET}" >&2
        exit 0
        ;;
    esac

    printf "检测脚本 URL: ${YELLOW}%s${RESET}\n" "$url"
    printf "您确定要继续吗? [y/n]: "
    read -r choice_confirm
    
    case "$choice_confirm" in
        y|Y)
        printf "--> 正在下载脚本到 %s ...\n" "$TMP_FILE"
        if ! curl -sSL -f -o "$TMP_FILE" "$url"; then
            printf "${RED}错误：下载脚本失败，请检查 URL 或网络连接。\n${RESET}" >&2
            exit 1
        fi
        printf "--> ${GREEN}下载完成，正在启动安装程序...${RESET}\n"
        chmod +x "$TMP_FILE"
        "$shell_to_use" "$TMP_FILE"
        printf "--> ${GREEN}安装脚本执行结束。${RESET}\n"
        ;;
        *)
        printf "--> ${YELLOW}操作已取消。${RESET}\n"
        exit 0
        ;;
    esac
}

case "$OS_FAMILY" in
    debian) main "Debian/Ubuntu" "bash" ;;
    rhel)    main "CentOS/RHEL/Fedora" "bash" ;;
    alpine) main "Alpine Linux" "bash" ;;
esac

exit 0
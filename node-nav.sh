#!/bin/bash

# =========================================================
# 脚本名称：Node-Nav 服务管理脚本 (Systemd)
# 功能说明：一键安装、配置、管理 Node.js 导航及隧道服务
# 适用系统：Ubuntu, Debian, CentOS, AlmaLinux 等 Systemd 系统
# =========================================================

# --- 全局配置变量 ---
APP_NAME="node-nav"                                     # 服务名称
INSTALL_DIR="/opt/$APP_NAME"                            # 安装目录
LOG_FILE="/var/log/${APP_NAME}_install.log"             # 安装日志路径
CONFIG_FILE_ENV="$INSTALL_DIR/config.env"               # 环境变量配置文件
CONFIG_FILE_SUB="$INSTALL_DIR/data/sub.txt"             # 订阅链接文件
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"    # Systemd 服务文件路径
ZIP_URL="https://github.com/llodys/node-nav/releases/download/node-nav/node-nav.zip" # 项目下载地址
ZIP_FILE="/tmp/$APP_NAME.zip"                           # 临时下载文件路径

SHORTCUT_NAME="nav"                                     # 快捷命令名称
SHORTCUT_PATH="/usr/local/bin/$SHORTCUT_NAME"           # 快捷命令路径
LOCAL_SCRIPT_PATH="$INSTALL_DIR/manage.sh"              # 本地脚本备份路径

OS_ID=""
PKG_MANAGER=""
NODE_SETUP_URL=""

# --- 终端颜色定义 ---
RED='\033[1;31m'; GREEN='\033[1;32m'; BRIGHT_GREEN='\033[1;32m'; YELLOW='\033[1;33m'
BLUE='\033[1;34m'; MAGENTA='\033[1;35m'; CYAN='\033[1;36m'; WHITE='\033[1;37m'; RESET='\033[0m'

# --- 基础输出函数 ---
red() { echo -e "${RED}$1${RESET}"; }
green() { echo -e "${GREEN}$1${RESET}"; }
bright_green() { echo -e "${BRIGHT_GREEN}$1${RESET}"; }
yellow() { echo -e "${YELLOW}$1${RESET}"; }
blue() { echo -e "${BLUE}$1${RESET}"; }
cyan() { echo -e "${CYAN}$1${RESET}"; }
white() { echo -e "${WHITE}$1${RESET}"; }

# --- 功能函数：读取现有配置 ---
load_existing_config() {
    if [ -f "$CONFIG_FILE_ENV" ]; then
        local TMP_ENV=$(mktemp)
        tr -d '\r' < "$CONFIG_FILE_ENV" > "$TMP_ENV"
        set -a
        source "$TMP_ENV"
        set +a
        rm -f "$TMP_ENV"
        
        UUID="${UUID:-}"
        PORT="${PORT:-3000}"
        ARGO_DOMAIN="${ARGO_DOMAIN:-}"
        ARGO_AUTH="${ARGO_AUTH:-}"
        ARGO_PORT="${ARGO_PORT:-8001}"
        CFIP="${CFIP:-cdns.doon.eu.org}"
        SUB_PATH="${SUB_PATH:-sub}"
        NAME="${NAME:-node}"
        ADMIN_PASSWORD="${ADMIN_PASSWORD:-123456}"
        return 0
    fi
    return 1
}

# --- 功能函数：自动获取公网IP ---
get_public_ip() {
    white "正在尝试获取服务器公网 IP (IPv4 & IPv6)..."
    
    SERVER_IP_AUTO=$(curl -s4 --max-time 5 https://api.ipify.org || curl -s4 --max-time 5 ifconfig.me || curl -s4 --max-time 5 http://oapi.co/myip)
    
    if [ -z "$SERVER_IP_AUTO" ] || [[ "$SERVER_IP_AUTO" != *.* ]]; then
        yellow "警告: 无法自动获取公网 IPv4 地址。"
    else
        green "已自动获取公网 IPv4: $SERVER_IP_AUTO"
    fi

    SERVER_IP_V6_AUTO=$(curl -s6 --max-time 5 https://api6.ipify.org || curl -s6 --max-time 5 icanhazip.com)

    if [ -z "$SERVER_IP_V6_AUTO" ] || [[ "$SERVER_IP_V6_AUTO" != *:* ]]; then
        yellow "警告: 未检测到公网 IPv6 地址或连接失败。"
    else
        green "已自动获取公网 IPv6: $SERVER_IP_V6_AUTO"
    fi
}

# --- 安全检查：确保 Root 权限 ---
check_root() {
    if [ "$EUID" -ne 0 ]; then
        red "错误: 此脚本需要 root 权限运行。"
        exit 1
    fi
}

# --- 工具函数：生成随机 UUID ---
generate_uuid() {
    command -v uuidgen &>/dev/null && uuidgen || \
    cat /proc/sys/kernel/random/uuid 2>/dev/null || \
    (command -v python3 &>/dev/null && python3 -c 'import uuid; print(uuid.uuid4())') || \
    (command -v python &>/dev/null && python -c 'import uuid; print(uuid.uuid4())') || \
    head -c 16 /dev/urandom | xxd -p
}

# --- 环境检查：识别操作系统与包管理器 ---
check_system() {
    if ! command -v systemctl &>/dev/null; then
        red "错误: 未找到 systemd (systemctl)。"
        exit 1
    fi

    if [ -f /etc/os-release ]; then
        source /etc/os-release
        OS_ID=$ID
    else
        red "无法检测操作系统。"
        exit 1
    fi

    case $OS_ID in
        ubuntu|debian)
            PKG_MANAGER="apt-get"
            NODE_SETUP_URL="https://deb.nodesource.com/setup_lts.x" 
            ;;
        centos|rhel|almalinux|rocky|fedora)
            PKG_MANAGER=$(command -v dnf &>/dev/null && echo "dnf" || echo "yum")
            NODE_SETUP_URL="https://rpm.nodesource.com/setup_lts.x" 
            ;;
        *)
            red "不支持的操作系统: $OS_ID"
            exit 1
            ;;
    esac

    white "检测到系统: $(green "$OS_ID") | 包管理器: $(green "$PKG_MANAGER")"
}

# --- 依赖管理：安装必要工具 ---
check_dependencies() {
    white "正在检查并安装基础依赖..."
    
    if [[ "$OS_ID" =~ ubuntu|debian ]]; then
        $PKG_MANAGER update -y >> "$LOG_FILE" 2>&1
        $PKG_MANAGER install -y curl unzip lsof uuid-runtime coreutils >> "$LOG_FILE" 2>&1
    elif [[ "$OS_ID" =~ centos|rhel|almalinux|rocky ]]; then
        $PKG_MANAGER install -y curl unzip lsof util-linux coreutils >> "$LOG_FILE" 2>&1
    fi

    for cmd in curl unzip lsof; do
        if ! command -v "$cmd" &>/dev/null; then
            red "错误: 依赖 '$cmd' 安装失败，请检查网络或手动安装。"
            exit 1
        fi
    done
}

# --- 环境配置：安装 Node.js ---
install_nodejs() {
    if command -v node &>/dev/null; then
        NODE_MAJOR_VERSION=$(node -v | sed 's/v\([0-9]\+\).*/\1/')
        white "检测 Node.js 版本: $(node -v)"
    else
        NODE_MAJOR_VERSION=0
        white "未检测到 Node.js"
    fi

    if [ "$NODE_MAJOR_VERSION" -lt 18 ]; then 
        yellow "Node.js 版本较低或不存在，正在安装/升级到最新 LTS 版本..."
        curl -fsSL "$NODE_SETUP_URL" | bash >> "$LOG_FILE" 2>&1
        "$PKG_MANAGER" install -y nodejs >> "$LOG_FILE" 2>&1
        if command -v node &>/dev/null; then
             white "Node.js 已安装: $(node -v)"
        else
            red "Node.js 安装失败！请检查日志 $LOG_FILE"
            exit 1
        fi
    fi
}

# --- 工具函数：检查端口占用 ---
check_port() {
    local port=$1
    if lsof -i:"$port" &>/dev/null; then
        red "端口 $port 已被占用，请换一个端口"
        return 1
    fi
    return 0
}

# --- UI函数：菜单状态栏 ---
check_status_for_menu() {
    PADDING="    " 

    STATUS_TEXT=""
    if [ -f "$SERVICE_FILE" ]; then
        if systemctl is-active --quiet "$APP_NAME"; then
            STATUS_TEXT="${CYAN}当前状态: $(bright_green "运行中")${RESET}"
        else
            STATUS_TEXT="${CYAN}当前状态: $(white "已停止")${RESET}"
        fi
    else
        STATUS_TEXT="${CYAN}当前状态: $(yellow "未安装")${RESET}"
    fi

    echo -e "${PADDING}${STATUS_TEXT}"
    echo -e "${CYAN}---------------------------------${RESET}"
}

# --- 流程函数：初始化变量 ---
initialize_install_vars() {
    PORT=3000
    ARGO_PORT=8001
    CFIP="cdns.doon.eu.org"
    SUB_PATH="sub"
    NAME="node"
    ADMIN_PASSWORD="123456"
    CFPORT=443
    UUID_GENERATED=false
    OLD_CONFIG_LOADED=false
    
    if load_existing_config; then
        OLD_CONFIG_LOADED=true
        yellow "检测到旧配置文件，将使用其值作为默认选项。"
        sleep 1
    fi
    
    get_public_ip
    UUID_DEFAULT="${UUID:-$(generate_uuid)}"

    if [ -f "$SERVICE_FILE" ]; then
        yellow "⚠️ 检测到服务已存在，将覆盖安装。"
    fi
}

# --- 流程函数：用户输入配置 ---
prompt_user_config() {
    cyan "--- 安装流程 ---"

    read -p "$(yellow "1. 请输入 用户UUID (留空自动生成): ")" UUID_INPUT
    if [ -z "$UUID_INPUT" ]; then
        UUID="$(generate_uuid)"
        UUID_GENERATED=true
        green "  -> 已自动生成新 UUID: $UUID"
    else
        UUID="$UUID_INPUT"
    fi

    while true; do
        read -p "$(yellow "2. 请输入 HTTP服务端口 [默认: $PORT]: ")" PORT_INPUT
        [ -z "$PORT_INPUT" ] && PORT_INPUT="$PORT"
        PORT="$PORT_INPUT"
        [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { red "请输入 1-65535 的有效端口号"; continue; }
        check_port "$PORT" || continue
        break
    done

    read -p "$(yellow "3. 请输入 固定隧道密钥 [$( [ -z "$ARGO_AUTH" ] && echo '必填' || echo '已配置')]: ")" ARGO_AUTH_INPUT
    [ -z "$ARGO_AUTH_INPUT" ] || ARGO_AUTH="$ARGO_AUTH_INPUT"

    read -p "$(yellow "4. 请输入 固定隧道域名 [$( [ -z "$ARGO_DOMAIN" ] && echo '必填' || echo "默认: $ARGO_DOMAIN" )]: ")" ARGO_DOMAIN_INPUT
    [ -z "$ARGO_DOMAIN_INPUT" ] || ARGO_DOMAIN="$ARGO_DOMAIN_INPUT"

    while true; do
        read -p "$(yellow "5. 请输入 Argo隧道端口 [默认: $ARGO_PORT]: ")" ARGO_PORT_INPUT
        [ -z "$ARGO_PORT_INPUT" ] && ARGO_PORT_INPUT="$ARGO_PORT"
        ARGO_PORT="$ARGO_PORT_INPUT"
        [[ "$ARGO_PORT" =~ ^[0-9]+$ ]] && [ "$ARGO_PORT" -ge 1 ] && [ "$ARGO_PORT" -le 65535 ] && break
        red "请输入 1-65535 的有效端口号。"
    done

    read -p "$(yellow "6. 请输入 优选域名或IP [默认: $CFIP]: ")" CFIP_INPUT
    [ -z "$CFIP_INPUT" ] || CFIP="$CFIP_INPUT"

    read -p "$(yellow "7. 请输入 订阅路径 [默认: $SUB_PATH]: ")" SUB_PATH_INPUT
    [ -z "$SUB_PATH_INPUT" ] || SUB_PATH="$SUB_PATH_INPUT"

    read -p "$(yellow "8. 请输入 节点名称前缀 [默认: $NAME]: ")" NAME_INPUT
    [ -z "$NAME_INPUT" ] || NAME="$NAME_INPUT"

    read -p "$(yellow "9. 请输入 书签管理密码 [默认: $ADMIN_PASSWORD]: ")" ADMIN_PASSWORD_INPUT
    [ -z "$ADMIN_PASSWORD_INPUT" ] || ADMIN_PASSWORD="$ADMIN_PASSWORD_INPUT"
}

# --- 流程函数：验证与确认 ---
validate_and_confirm() {
    if [ -z "$ARGO_DOMAIN" ] || [ -z "$ARGO_AUTH" ]; then
        clear
        red "错误: ARGO_DOMAIN (隧道域名) 和 ARGO_AUTH (隧道密钥) 为必填项！"
        yellow "请重新运行安装流程并确保填写。"
        sleep 3
        return 1
    fi

    if ! check_port "$PORT"; then
        red "错误: HTTP服务端口 $PORT 冲突，请修改后重试。"
        sleep 3
        return 1
    fi

    clear
    cyan "--- 请确认配置 ---"
    
    echo -e "UUID: $(green "$UUID")" $( [ "$UUID_GENERATED" = true ] && bright_green " (已自动生成)" || true )
    echo -e "HTTP端口: $(green "$PORT")"
    echo -e "隧道密钥: $(green "$ARGO_AUTH")"$( [ "$OLD_CONFIG_LOADED" = true ] && yellow " (旧值)" || true )
    echo -e "隧道域名: $(green "$ARGO_DOMAIN")"
    echo -e "Argo端口: $(green "$ARGO_PORT")"
    echo -e "优选IP/域名: $(green "$CFIP")"
    echo -e "订阅路径: $(green "$SUB_PATH")"
    echo -e "节点名称前缀: $(green "$NAME")"
    echo -e "书签密码: $(green "$ADMIN_PASSWORD")"
    
    echo -e "${CYAN}---------------------------------${RESET}"
    read -p "$(yellow "确认开始安装? (y/n): ")" confirm
    [[ ! "$confirm" =~ [yY] ]] && yellow "安装已取消" && return 1
    
    return 0
}

# --- 系统配置：创建本地快捷方式 ---
create_shortcut() {
    white "⚙️ 正在配置本地快捷命令..."
    
    mkdir -p /usr/local/bin

    cp "$0" "$LOCAL_SCRIPT_PATH"
    chmod +x "$LOCAL_SCRIPT_PATH"

    cat > "$SHORTCUT_PATH" << EOF
#!/bin/bash
if [ -f "$LOCAL_SCRIPT_PATH" ]; then
    bash "$LOCAL_SCRIPT_PATH" "\$@"
else
    echo "错误: 管理脚本 $LOCAL_SCRIPT_PATH 不存在。"
fi
EOF

    chmod +x "$SHORTCUT_PATH"
    
    echo ""
    bright_green "✅ 快捷命令已更新！"
    echo -e "以后在终端直接输入 ${CYAN}${SHORTCUT_NAME}${RESET} 即可打开菜单 (无需联网)。"
    echo ""
}

# --- 核心任务：执行安装与服务配置 ---
perform_core_installation() {
    bright_green "🚀 开始安装 (Systemd模式)... 日志: $LOG_FILE"
    [ -f "$SERVICE_FILE" ] && systemctl stop "$APP_NAME" &>/dev/null || true
    install_nodejs
    
    white "👥 创建专用非Root用户 '$APP_NAME'..."
    id -u "$APP_NAME" &>/dev/null || useradd -r -m -s /usr/sbin/nologin "$APP_NAME"

    white "📦 下载并解压项目文件..."
    curl -L -o "$ZIP_FILE" "$ZIP_URL" >> "$LOG_FILE" 2>&1
    rm -rf "$INSTALL_DIR"; mkdir -p "$INSTALL_DIR"
    unzip -q "$ZIP_FILE" -d "$INSTALL_DIR"; rm -f "$ZIP_FILE"

    cd "$INSTALL_DIR"
    white "🛠️ 安装 npm 依赖..."
    
    if ! npm install --omit=dev --silent 2>> "$LOG_FILE"; then
        red "❌ 错误: npm install 失败！"
        yellow "最近的安装日志片段如下 ($LOG_FILE):"
        tail -n 10 "$LOG_FILE"
        exit 1
    fi

    white "创建配置文件..."
    cat > "$CONFIG_FILE_ENV" <<EOF
PORT=${PORT}
UUID=${UUID}
NAME=${NAME}
ARGO_DOMAIN=${ARGO_DOMAIN}
ARGO_AUTH=${ARGO_AUTH}
ARGO_PORT=${ARGO_PORT}
CFIP=${CFIP}
CFPORT=${CFPORT}
NEZHA_SERVER=
NEZHA_PORT=
NEZHA_KEY=
UPLOAD_URL=
PROJECT_URL=https://www.google.com
AUTO_ACCESS=false
FILE_PATH=./data
SUB_PATH=${SUB_PATH}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
NODE_ENV=production
EOF

    white "🔐 设置文件权限为 '$APP_NAME' 用户..."
    chown -R "$APP_NAME":"$APP_NAME" "$INSTALL_DIR"
    chmod 600 "$CONFIG_FILE_ENV"

    white "📝 创建 systemd 服务..."
    NODE_BIN=$(command -v node)

    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=$APP_NAME Service
After=network.target
[Service]
Type=simple
User=$APP_NAME
Group=$APP_NAME
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_BIN $INSTALL_DIR/app.js
Restart=always
EnvironmentFile=$CONFIG_FILE_ENV
PrivateTmp=true
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=true
StandardOutput=append:/var/log/${APP_NAME}.log
StandardError=append:/var/log/${APP_NAME}.err
[Install]
WantedBy=multi-user.target
EOF

    touch /var/log/${APP_NAME}.log /var/log/${APP_NAME}.err
    chown $APP_NAME:$APP_NAME /var/log/${APP_NAME}.log /var/log/${APP_NAME}.err

    systemctl daemon-reload
    systemctl enable "$APP_NAME"
    systemctl start "$APP_NAME"

    create_shortcut

    yellow "1.服务已安装完成！服务已启动并开机自启"
    yellow "2. 请等待1分钟后, 在菜单里使用 ${CYAN}4.查看订阅链接${YELLOW}。"
}

# --- 菜单功能：1. 安装服务 ---
install_service() {
    check_root
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "--- 安装日志开始于 $(date) ---" > "$LOG_FILE"

    initialize_install_vars || return 1
    prompt_user_config || return 1
    validate_and_confirm || return 1
    perform_core_installation
}

# --- 菜单功能：2. 卸载服务 ---
uninstall_service() {
    check_root
    read -p "$(yellow "确定删除 '$APP_NAME' 及所有文件? (y/n): ")" confirm
    [[ ! "$confirm" =~ [yY] ]] && cyan "卸载已取消" && return
    
    systemctl stop "$APP_NAME" &>/dev/null || true
    systemctl disable "$APP_NAME" &>/dev/null || true
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
    
    pkill -u "$APP_NAME" || true
    userdel -r "$APP_NAME" &>/dev/null || true
    
    rm -rf "$INSTALL_DIR"
    rm -f /var/log/${APP_NAME}.log /var/log/${APP_NAME}.err
    
    if [ -f "$SHORTCUT_PATH" ]; then
        rm -f "$SHORTCUT_PATH"
        white "快捷命令已移除: $SHORTCUT_PATH"
    fi

    if [ -f "/usr/bin/$SHORTCUT_NAME" ]; then
        rm -f "/usr/bin/$SHORTCUT_NAME"
        white "清理旧版快捷命令: /usr/bin/$SHORTCUT_NAME"
    fi

    bright_green "✅ 服务已卸载，用户和安装目录已删除。"
    # 修复：卸载后直接退出，防止由于管道执行导致的 printf 报错
    exit 0
}

# --- 菜单功能：3. 重启服务 ---
restart_service() {
    check_root
    if [ ! -f "$SERVICE_FILE" ]; then
        red "错误: 服务文件 $SERVICE_FILE 不存在，请先执行安装 (选项 1)。"
        return 1
    fi
    
    white "⚙️ 正在重启服务，请稍候..."
    if systemctl restart "$APP_NAME" 2>/dev/null; then
        bright_green "✅ 服务已重启"
    else
        red "❌ 重启失败，请查看状态 (选项 6) 获取更多信息。"
    fi
}

# --- 菜单功能：6. 查看状态 ---
view_status() {
    if [ ! -f "$SERVICE_FILE" ]; then
        red "错误: 服务文件 $SERVICE_FILE 不存在，请先执行安装 (选项 1)。"
        return 1
    fi
    clear
    cyan "--- ${APP_NAME} 服务状态 ---"
    systemctl --no-pager status "$APP_NAME"
    echo ""
    
    cyan "--- 📝 最新运行日志 (Last 5 lines) ---"
    tail -n 5 "/var/log/${APP_NAME}.log" 2>/dev/null
    
    if [ -s "/var/log/${APP_NAME}.err" ]; then
        echo ""
        red "--- ⚠️ 检测到错误日志 (Last 5 lines) ---"
        tail -n 5 "/var/log/${APP_NAME}.err" 2>/dev/null
    fi
    
    echo ""
    read -n 1 -s -r -p "按任意键返回主菜单..."
    echo ""
}

# --- 菜单功能：4. 查看订阅 ---
view_subscription() {
    if [ ! -f "$SERVICE_FILE" ]; then red "服务未安装"; sleep 2; return; fi
    if [ -f "$CONFIG_FILE_SUB" ] && [ -s "$CONFIG_FILE_SUB" ]; then
        clear
        cyan "\n--- 🔗 订阅链接 ---"
        cat "$CONFIG_FILE_SUB"
        echo
        cyan "----------------"
        read -n 1 -s -r -p "按任意键返回主菜单..."
        echo ""
    else
        red "❌ 订阅文件不存在或为空"
        yellow "请确保服务运行并等待1-2分钟后重试"
        read -n 1 -s -r -p "按任意键返回主菜单..."
        echo ""
    fi
}

# --- 菜单功能：5. 修改配置 ---
edit_variables() {
    check_root
    [ ! -f "$CONFIG_FILE_ENV" ] && red "配置文件不存在，请先安装服务" && sleep 2 && return
    
    cp "$CONFIG_FILE_ENV" "$CONFIG_FILE_ENV.bak"

    update_config_value() {
        local key=$1
        local val=$2
        local ESCAPED_VAL=$(echo "$val" | sed 's/\\/\\\\/g' | sed 's/#/\\#/g' | sed 's/&/\\&/g')
        
        if grep -q "^$key=" "$CONFIG_FILE_ENV"; then
            sed -i "s|^$key=.*|$key=$ESCAPED_VAL|#" "$CONFIG_FILE_ENV"
        else
            echo "$key=$val" >> "$CONFIG_FILE_ENV"
        fi
    }

    show_var() {
        [ -z "$1" ] && echo "$(yellow "未设置")" || echo "$(green "$1")"
    }

    reload_config() {
        if [ -f "$CONFIG_FILE_ENV" ]; then
            local TMP_ENV=$(mktemp)
            tr -d '\r' < "$CONFIG_FILE_ENV" > "$TMP_ENV"
            set -a
            source "$TMP_ENV"
            set +a
            rm -f "$TMP_ENV"
        fi
    }

    save_and_restart() {
        reload_config
        if [ -z "$ARGO_DOMAIN" ] || [ -z "$ARGO_AUTH" ]; then
            red "错误: Argo域名和密钥不能为空！"
            sleep 2
            return 1
        fi
        rm "$CONFIG_FILE_ENV.bak"
        bright_green "✅ 配置已保存，正在重启服务..."
        restart_service
        sleep 1
        return 0
    }

    validate_port() {
        local val=$1; local name=$2
        if ! [[ "$val" =~ ^[0-9]+$ ]] || [ "$val" -lt 1 ] || [ "$val" -gt 65535 ]; then
            red "错误: $name 必须是 1-65535 的有效端口号。"
            return 1
        fi
        if [ "$name" == "PORT" ]; then
            local CURRENT_PORT=$(grep '^PORT=' "$CONFIG_FILE_ENV" | cut -d '=' -f 2 | tr -d '\r')
            if [ "$val" != "$CURRENT_PORT" ] && lsof -i:"$val" &>/dev/null; then
                red "错误: 端口 $val 已被占用。"
                return 1
            fi
        fi
        return 0
    }

    submenu_basic() {
        while true; do
            clear; reload_config
            echo -e "${CYAN}╭───────────────────────────────────╮${RESET}"
            echo -e "${CYAN}│     ${WHITE}基础设置 (UUID, 端口, 名称)   ${CYAN}│${RESET}"
            echo -e "${CYAN}╰───────────────────────────────────╯${RESET}"
            echo -e "${YELLOW}═══ ${WHITE}当前配置${YELLOW} ════════════════════════${RESET}"
            echo -e "${GREEN} 1. ${RESET}UUID: $(show_var "$UUID")"
            echo -e "${GREEN} 2. ${RESET}节点名称: $(show_var "$NAME")"
            echo -e "${GREEN} 3. ${RESET}服务端口: $(show_var "$PORT")"
            echo -e "${YELLOW}═════════════════════════════════════${RESET}"
            echo -e "${BRIGHT_GREEN} S. ${RESET}保存并重启服务"
            echo -e "${RED} 0. ${RESET}返回上一页"
            echo -e "${CYAN}─────────────────────────────────────${RESET}"
            read -rp "$(yellow "请选择: ")" sub_choice
            case $sub_choice in
                1) read -p "输入新 UUID: " v; [ -z "$v" ] && v=$(generate_uuid); update_config_value "UUID" "$v" ;;
                2) read -p "输入新 名称前缀: " v; update_config_value "NAME" "$v" ;;
                3) read -p "输入新 HTTP端口: " v; validate_port "$v" "PORT" && update_config_value "PORT" "$v" ;;
                [sS]) if save_and_restart; then return 10; fi ;;
                0) return 0 ;;
                *) red "无效选项"; sleep 0.5 ;;
            esac
        done
    }

    submenu_argo() {
        while true; do
            clear; reload_config
            echo -e "${CYAN}╭───────────────────────────────────╮${RESET}"
            echo -e "${CYAN}│     ${WHITE}Argo 隧道设置 (域名, 密钥)    ${CYAN}│${RESET}"
            echo -e "${CYAN}╰───────────────────────────────────╯${RESET}"
            echo -e "${YELLOW}═══ ${WHITE}当前配置${YELLOW} ════════════════════════${RESET}"
            echo -e "${GREEN} 1. ${RESET}固定隧道域名: $(show_var "$ARGO_DOMAIN")"
            echo -e "${GREEN} 2. ${RESET}固定隧道密钥: $(green "$ARGO_AUTH")"
            echo -e "${GREEN} 3. ${RESET}Argo隧道端口: $(show_var "$ARGO_PORT")"
            echo -e "${YELLOW}═════════════════════════════════════${RESET}"
            echo -e "${BRIGHT_GREEN} S. ${RESET}保存并重启服务"
            echo -e "${RED} 0. ${RESET}返回上一页"
            echo -e "${CYAN}─────────────────────────────────────${RESET}"
            read -rp "$(yellow "请选择: ")" sub_choice
            case $sub_choice in
                1) read -p "输入新 隧道域名: " v; update_config_value "ARGO_DOMAIN" "$v" ;;
                2) read -s -p "输入新 隧道密钥: " v; echo; update_config_value "ARGO_AUTH" "$v" ;; 
                3) read -p "输入新 Argo端口: " v; validate_port "$v" "ARGO_PORT" && update_config_value "ARGO_PORT" "$v" ;;
                [sS]) if save_and_restart; then return 10; fi ;;
                0) return 0 ;;
                *) red "无效选项"; sleep 0.5 ;;
            esac
        done
    }

    submenu_network() {
        while true; do
            clear; reload_config
            echo -e "${CYAN}╭───────────────────────────────────╮${RESET}"
            echo -e "${CYAN}│     ${WHITE}节点网络 (优选IP, 路径)       ${CYAN}│${RESET}"
            echo -e "${CYAN}╰───────────────────────────────────╯${RESET}"
            echo -e "${YELLOW}═══ ${WHITE}当前配置${YELLOW} ════════════════════════${RESET}"
            echo -e "${GREEN} 1. ${RESET}优选域名: $(show_var "$CFIP")"
            echo -e "${GREEN} 2. ${RESET}节点端口: $(show_var "$CFPORT")"
            echo -e "${GREEN} 3. ${RESET}订阅路径: $(show_var "$SUB_PATH")"
            echo -e "${YELLOW}═════════════════════════════════════${RESET}"
            echo -e "${BRIGHT_GREEN} S. ${RESET}保存并重启服务"
            echo -e "${RED} 0. ${RESET}返回上一页"
            echo -e "${CYAN}─────────────────────────────────────${RESET}"
            read -rp "$(yellow "请选择: ")" sub_choice
            case $sub_choice in
                1) read -p "输入新 优选IP: " v; update_config_value "CFIP" "$v" ;;
                2) read -p "输入新 节点端口: " v; update_config_value "CFPORT" "$v" ;;
                3) read -p "输入新 订阅路径: " v; update_config_value "SUB_PATH" "$v" ;;
                [sS]) if save_and_restart; then return 10; fi ;;
                0) return 0 ;;
                *) red "无效选项"; sleep 0.5 ;;
            esac
        done
    }

    submenu_nezha() {
        while true; do
            clear; reload_config
            echo -e "${CYAN}╭───────────────────────────────────╮${RESET}"
            echo -e "${CYAN}│     ${WHITE}哪吒监控 (服务器, 密钥)       ${CYAN}│${RESET}"
            echo -e "${CYAN}╰───────────────────────────────────╯${RESET}"
            echo -e "${YELLOW}═══ ${WHITE}当前配置${YELLOW} ════════════════════════${RESET}"
            echo -e "${GREEN} 1. ${RESET}哪吒服务: $(show_var "$NEZHA_SERVER")"
            echo -e "${GREEN} 2. ${RESET}哪吒端口: $(show_var "$NEZHA_PORT")"
            echo -e "${GREEN} 3. ${RESET}哪吒密钥: $(show_var "$NEZHA_KEY")"
            echo -e "${YELLOW}═════════════════════════════════════${RESET}"
            echo -e "${BRIGHT_GREEN} S. ${RESET}保存并重启服务"
            echo -e "${RED} 0. ${RESET}返回上一页"
            echo -e "${CYAN}─────────────────────────────────────${RESET}"
            read -rp "$(yellow "请选择: ")" sub_choice
            case $sub_choice in
                1) read -p "输入新 哪吒服务器: " v; update_config_value "NEZHA_SERVER" "$v" ;;
                2) read -p "输入新 哪吒端口: " v; update_config_value "NEZHA_PORT" "$v" ;;
                3) read -p "输入新 哪吒密钥: " v; update_config_value "NEZHA_KEY" "$v" ;;
                [sS]) if save_and_restart; then return 10; fi ;;
                0) return 0 ;;
                *) red "无效选项"; sleep 0.5 ;;
            esac
        done
    }

    submenu_advanced() {
        while true; do
            clear; reload_config
            echo -e "${CYAN}╭───────────────────────────────────╮${RESET}"
            echo -e "${CYAN}│     ${WHITE}高级选项 (保活, 密码, 路径)   ${CYAN}│${RESET}"
            echo -e "${CYAN}╰───────────────────────────────────╯${RESET}"
            echo -e "${YELLOW}═══ ${WHITE}当前配置${YELLOW} ════════════════════════${RESET}"
            echo -e "${GREEN} 1. ${RESET}订阅上传地址: $(show_var "$UPLOAD_URL")"
            echo -e "${GREEN} 2. ${RESET}项目分配域名: $(show_var "$PROJECT_URL")"
            echo -e "${GREEN} 3. ${RESET}自动访问保活: $(show_var "$AUTO_ACCESS")"
            echo -e "${GREEN} 4. ${RESET}项目运行目录: $(show_var "$FILE_PATH")"
            echo -e "${GREEN} 5. ${RESET}后台管理密码: $(green "$ADMIN_PASSWORD")"
            echo -e "${YELLOW}═════════════════════════════════════${RESET}"
            echo -e "${BRIGHT_GREEN} S. ${RESET}保存并重启服务"
            echo -e "${RED} 0. ${RESET}返回上一页"
            echo -e "${CYAN}─────────────────────────────────────${RESET}"
            read -rp "$(yellow "请选择: ")" sub_choice
            case $sub_choice in
                1) read -p "输入新 上传地址: " v; update_config_value "UPLOAD_URL" "$v" ;;
                2) read -p "输入新 项目域名: " v; update_config_value "PROJECT_URL" "$v" ;;
                3) read -p "是否开启保活 (true/false): " v; update_config_value "AUTO_ACCESS" "$v" ;;
                4) read -p "输入新 运行目录: " v; update_config_value "FILE_PATH" "$v" ;;
                5) read -s -p "输入新 管理密码: " v; echo; update_config_value "ADMIN_PASSWORD" "$v" ;;
                [sS]) if save_and_restart; then return 10; fi ;;
                0) return 0 ;;
                *) red "无效选项"; sleep 0.5 ;;
            esac
        done
    }

    # --- 配置主菜单循环 ---
    while true; do
        clear
        echo -e "${CYAN}╭───────────────────────────────────╮${RESET}"
        echo -e "${CYAN}│            ${WHITE}配置参数菜单           ${CYAN}│${RESET}"
        echo -e "${CYAN}╰───────────────────────────────────╯${RESET}"
        
        echo -e "${YELLOW}═══ ${WHITE}配置分类${YELLOW} ════════════════════════${RESET}"
        echo -e "${GREEN} 1. ${RESET}基础设置"
        echo -e "${GREEN} 2. ${RESET}Argo设置"
        echo -e "${GREEN} 3. ${RESET}节点网络"
        echo -e "${GREEN} 4. ${RESET}哪吒监控"
        echo -e "${GREEN} 5. ${RESET}高级选项"
        echo -e "${YELLOW}═════════════════════════════════════${RESET}"
        echo -e "${RED} 0. ${RESET}返回上一页"
        echo -e "${CYAN}─────────────────────────────────────${RESET}"
        
        read -rp "$(yellow "请输入选项: ")" choice

        case $choice in
            1) submenu_basic; [ $? -eq 10 ] && break ;;
            2) submenu_argo; [ $? -eq 10 ] && break ;;
            3) submenu_network; [ $? -eq 10 ] && break ;;
            4) submenu_nezha; [ $? -eq 10 ] && break ;;
            5) submenu_advanced; [ $? -eq 10 ] && break ;;
            0) 
                if [ -f "$CONFIG_FILE_ENV.bak" ]; then
                    mv "$CONFIG_FILE_ENV.bak" "$CONFIG_FILE_ENV"
                    yellow "未保存配置，已恢复原文件。"
                    sleep 1
                fi
                break
                ;;
            *) 
                red "无效选项" 
                sleep 0.5 
                ;;
        esac
    done
}

# --- 程序主入口 ---
main() {
    clear
    check_root
    check_system
    check_dependencies

    while true; do
        clear
        
        echo -e "${CYAN}╭───────────────────────────────────╮${RESET}"
        echo -e "${CYAN}│     ${WHITE}node-nav 服务管理脚本 v1.2    ${CYAN}│${RESET}"
        echo -e "${CYAN}╰───────────────────────────────────╯${RESET}"
        
        check_status_for_menu 
        
        SERVICE_INSTALLED=false
        if [ -f "$SERVICE_FILE" ]; then
            SERVICE_INSTALLED=true
            install_option_text="重装服务" 
            READ_PROMPT="请输入选项 [0-6]: "
        else
            install_option_text="安装服务"
            READ_PROMPT="请输入选项 [0-1]: "
        fi

        echo -e "${YELLOW}═══ ${WHITE}核心功能${YELLOW} ════════════════════════${RESET}"
        echo -e "${GREEN} 1. ${RESET}${install_option_text}"

        if [ "$SERVICE_INSTALLED" = true ]; then
            echo -e "${GREEN} 2. ${RESET}卸载服务"
            echo -e "${GREEN} 3. ${RESET}重启服务"
            echo -e "${GREEN} 4. ${RESET}${YELLOW}查看订阅链接${RESET}" 
            
            echo -e "${YELLOW}═══ ${WHITE}服务管理${YELLOW} ════════════════════════${RESET}"
            echo -e "${GREEN} 5. ${RESET}修改配置"
            echo -e "${GREEN} 6. ${RESET}查看服务状态"
        fi

        echo -e "${YELLOW}═════════════════════════════════════${RESET}"
        echo -e "${RED} 0. ${RESET}退出脚本"
        echo -e "${CYAN}─────────────────────────────────────${RESET}"
        
        read -rp "$(yellow "$READ_PROMPT")" num

        if [ "$SERVICE_INSTALLED" = false ] && [[ "$num" =~ ^[2-6]$ ]]; then
            red "无效选项"
            read -n 1 -s -r -p "按任意键返回主菜单..."
            echo ""
            continue
        fi

        case $num in
            1) install_service ;;
            2) uninstall_service ;;
            3) restart_service ;;
            4) view_subscription ;;
            5) edit_variables ;;
            6) view_status ;;
            0) exit 0 ;;
            *) red "无效选项" 
               read -n 1 -s -r -p "按任意键返回主菜单..."
               echo ""
            ;;
        esac
        
        [[ "$num" =~ ^[13456]$ ]] && {
            read -n 1 -s -r -p "按任意键返回主菜单..." < /dev/tty
            echo ""
        }
    done
}

main

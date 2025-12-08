#!/bin/bash
set -e

APP_NAME="node-nav"
INSTALL_DIR="/opt/$APP_NAME"
LOG_FILE="/var/log/${APP_NAME}_install.log"
CONFIG_FILE_ENV="$INSTALL_DIR/config.env"
SERVICE_FILE="/etc/systemd/system/$APP_NAME.service"
ZIP_URL="https://github.com/llodys/node-nav/releases/download/node-nav/node-nav.zip"
ZIP_FILE="/tmp/$APP_NAME.zip"

SHORTCUT_NAME="nav"
SHORTCUT_PATH="/usr/local/bin/$SHORTCUT_NAME"
SCRIPT_URL="https://raw.githubusercontent.com/llodys/node-nav/main/node-nav.sh"

OS_ID=""
PKG_MANAGER=""
NODE_SETUP_URL=""

RED='\033[1;31m'; GREEN='\033[1;32m'; BRIGHT_GREEN='\033[1;32m'; YELLOW='\033[1;33m'
CYAN='\033[1;36m'; RESET='\033[0m'

red() { echo -e "${RED}$1${RESET}"; }
green() { echo -e "${GREEN}$1${RESET}"; }
bright_green() { echo -e "${BRIGHT_GREEN}$1${RESET}"; }
yellow() { echo -e "${YELLOW}$1${RESET}"; }
cyan() { echo -e "${CYAN}$1${RESET}"; }
white() { echo -e "${WHITE}$1${RESET}"; }

load_existing_config() {
    if [ -f "$CONFIG_FILE_ENV" ]; then
        local TMP_ENV=$(mptemp)
        tr -d '\r' < "$CONFIG_FILE_ENV" > "$TMP_ENV"
        set -a
        source "$TMP_ENV"
        set +a
        rm -f "$TMP_ENV"
        
        PORT="${PORT:-3000}"
        ADMIN_PASSWORD="${ADMIN_PASSWORD:-123456}"
        return 0
    fi
    return 1
}

get_public_ip() {
    white "正在尝试获取服务器公网 IP (IPv4 & IPv6)..."
    
    if ! command -v curl &>/dev/null; then return; fi

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

check_root() {
    if [ "$EUID" -ne 0 ]; then
        red "错误: 此脚本需要 root 权限运行。"
        exit 1
    fi
}

check_system() {
    if ! command -v systemctl &>/dev/null; then
        red "错误: 未找到 systemd (systemctl)。此脚本仅支持 Systemd 系统。"
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
            PKG_MANAGER="apt"
            NODE_SETUP_URL="https://deb.nodesource.com/setup_24.x"
            ;;
        centos|rhel|almalinux|rocky|fedora)
            PKG_MANAGER=$(command -v dnf &>/dev/null && echo "dnf" || echo "yum")
            NODE_SETUP_URL="https://rpm.nodesource.com/setup_24.x"
            ;;
        *)
            red "不支持的操作系统: $OS_ID"
            exit 1
            ;;
    esac

    white "检测到系统: $(green "$OS_ID") | 包管理器: $(green "$PKG_MANAGER")"
}

check_dependencies() {
    for cmd in curl unzip lsof; do
        if ! command -v "$cmd" &>/dev/null; then
            red "缺少命令 '$cmd'，正在尝试安装..."
            if ! "$PKG_MANAGER" install -y "$cmd" >> "$LOG_FILE" 2>&1; then
                red "错误: 依赖安装失败 '$cmd'。请手动安装。"
                exit 1
            fi
        fi
    done
    
    # 移除了 uuidgen 检查
}

install_nodejs() {
    if command -v node &>/dev/null; then
        NODE_MAJOR_VERSION=$(node -v | sed 's/v\([0-9]\+\).*/\1/')
        white "检测 Node.js 版本: $(node -v)"
    else
        NODE_MAJOR_VERSION=0
        white "未检测到 Node.js"
    fi

    if [ "$NODE_MAJOR_VERSION" -lt 24 ]; then
        yellow "Node.js 版本低于 v24 (LTS)，正在安装/升级..."
        # 针对 RHEL/CentOS/Fedora，需要安装 EPEL
        if [[ "$OS_ID" =~ centos|rhel|almalinux|rocky|fedora ]]; then
            if command -v dnf &>/dev/null; then
                dnf install -y epel-release >> "$LOG_FILE" 2>&1
            elif command -v yum &>/dev/null; then
                yum install -y epel-release >> "$LOG_FILE" 2>&1
            fi
        fi

        curl -fsSL "$NODE_SETUP_URL" | bash >> "$LOG_FILE" 2>&1
        "$PKG_MANAGER" install -y nodejs >> "$LOG_FILE" 2>&1
        
        if command -v node &>/dev/null; then
             white "Node.js 已安装: $(node -v)"
        else
            red "Node.js 安装失败！"
            exit 1
        fi
    fi
}

check_port() {
    local port=$1
    if lsof -i:"$port" &>/dev/null; then
        red "端口 $port 已被占用，请换一个端口"
        return 1
    fi
    return 0
}

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
    
    cyan "---------------------------------"
}

initialize_install_vars() {
    PORT=3000
    ADMIN_PASSWORD="123456"
    
    if load_existing_config; then
        OLD_CONFIG_LOADED=true
        yellow "检测到旧配置文件，将使用其值作为默认选项。"
        sleep 1
    fi
    
    get_public_ip

    if [ -f "$SERVICE_FILE" ]; then
        yellow "检测到服务已存在，将覆盖安装。"
    fi
}

prompt_user_config() {
    cyan "--- 安装流程 ---"

    while true; do
        read -p "$(yellow "1. 请输入 HTTP服务端口 [默认: $PORT]: ")" PORT_INPUT
        [ -z "$PORT_INPUT" ] && PORT_INPUT="$PORT"
        PORT="$PORT_INPUT"
        [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || { red "请输入 1-65535 的有效端口号"; continue; }
        check_port "$PORT" || continue
        break
    done

    read -p "$(yellow "2. 请输入 书签管理密码 [默认: $ADMIN_PASSWORD]: ")" ADMIN_PASSWORD_INPUT
    [ -z "$ADMIN_PASSWORD_INPUT" ] || ADMIN_PASSWORD="$ADMIN_PASSWORD_INPUT"
}

validate_and_confirm() {
    if ! check_port "$PORT"; then
        red "错误: HTTP服务端口 $PORT 冲突，请修改后重试。"
        sleep 3
        return 1
    fi

    clear
    cyan "--- 请确认配置 ---"
    
    echo -e "HTTP端口: $(green "$PORT")"
    echo -e "书签密码: $(green "********")"
    
    cyan "---------------------------------"
    read -p "$(yellow "确认开始安装? (y/n): ")" confirm
    [[ ! "$confirm" =~ [yY] ]] && yellow "安装已取消" && return 1
    
    return 0
}

create_shortcut() {
    white "正在创建全局快捷命令..."
    
    mkdir -p /usr/local/bin

    cat > "$SHORTCUT_PATH" << 'EOFSCRIPT'
#!/bin/bash
RED='\033[1;31m'
CYAN='\033[1;36m'
RESET='\033[0m'

if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}错误: 请以 root 权限运行此命令。${RESET}"
    exit 1
fi

SCRIPT_URL="https://raw.githubusercontent.com/llodys/node-nav/main/node-nav.sh"

echo -e "${CYAN}正在连接服务器获取最新管理脚本 (Systemd)...${RESET}"
TMP_SCRIPT=$(mktemp)
if curl -sL "$SCRIPT_URL" -o "$TMP_SCRIPT"; then
    bash "$TMP_SCRIPT"
    rm -f "$TMP_SCRIPT"
else
    echo -e "${RED}获取脚本失败，请检查网络连接。${RESET}"
    rm -f "$TMP_SCRIPT"
    exit 1
fi
EOFSCRIPT

    chmod +x "$SHORTCUT_PATH"
    
    echo ""
    bright_green "快捷命令已创建！"
    echo -e "以后在终端直接输入 ${CYAN}${SHORTCUT_NAME}${RESET} 即可获取最新脚本并打开菜单。"
    echo ""
}

perform_core_installation() {
    bright_green "开始安装 (Systemd模式)... 日志: $LOG_FILE"
    [ -f "$SERVICE_FILE" ] && systemctl stop "$APP_NAME" &>/dev/null || true
    install_nodejs
    
    white "创建专用非Root用户 '$APP_NAME'..."
    # 移除了 -m 选项，不创建主目录
    id -u "$APP_NAME" &>/dev/null || useradd -r -s /usr/sbin/nologin "$APP_NAME"

    white "下载项目文件..."
    curl -L -o "$ZIP_FILE" "$ZIP_URL" >> "$LOG_FILE" 2>&1
    rm -rf "$INSTALL_DIR"; mkdir -p "$INSTALL_DIR"
    unzip -q "$ZIP_FILE" -d "$INSTALL_DIR"; rm -f "$ZIP_FILE"

    cd "$INSTALL_DIR"
    white "安装 npm 依赖..."
    
    if ! npm install --omit=dev --silent 2>> "$LOG_FILE"; then
        red "错误: npm install 失败！"
        yellow "最近的安装日志片段如下 ($LOG_FILE):"
        tail -n 10 "$LOG_FILE"
        exit 1
    fi

    white "创建配置文件..."
    cat > "$CONFIG_FILE_ENV" <<EOF
PORT=${PORT}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
NODE_ENV=production
EOF

    white "设置文件权限为 '$APP_NAME' 用户..."
    chown -R "$APP_NAME":"$APP_NAME" "$INSTALL_DIR"
    chmod 600 "$CONFIG_FILE_ENV"

    white "创建 systemd 服务..."

    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=$APP_NAME Service
After=network.target
[Service]
Type=simple
User=$APP_NAME
Group=$APP_NAME
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/env node $INSTALL_DIR/app.js
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

    yellow "服务已安装完成！服务已启动并开机自启"
}

install_service() {
    check_root
    mkdir -p "$(dirname "$LOG_FILE")"
    echo "--- 安装日志开始于 $(date) ---" > "$LOG_FILE"

    initialize_install_vars || return 1
    prompt_user_config || return 1
    validate_and_confirm || return 1
    perform_core_installation
}

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

    bright_green "服务已卸载，用户和安装目录已删除。"
    exit 0
}

restart_service() {
    check_root
    if [ ! -f "$SERVICE_FILE" ]; then
        red "错误: 服务文件 $SERVICE_FILE 不存在，请先执行安装 (选项 1)。"
        return 1
    fi
    
    if systemctl restart "$APP_NAME" 2>/dev/null; then
        bright_green "服务已重启"
    else
        red "重启失败，请查看状态 (选项 5) 获取更多信息。"
    fi
}

view_status() {
    if [ ! -f "$SERVICE_FILE" ]; then
        red "错误: 服务文件 $SERVICE_FILE 不存在，请先执行安装 (选项 1)。"
        return 1
    fi
    systemctl --no-pager status "$APP_NAME"
    echo ""
    yellow "--- 错误日志末尾 ($APP_NAME.err) ---"
    tail -n 10 "/var/log/${APP_NAME}.err" 2>/dev/null
}

edit_variables() {
    check_root
    [ ! -f "$CONFIG_FILE_ENV" ] && red "配置文件不存在，请先安装服务" && sleep 2 && return
    
    cp "$CONFIG_FILE_ENV" "$CONFIG_FILE_ENV.bak"

    update_config_value() {
        local key=$1
        local val=$2
        local SAFE_NEW_VALUE=$(echo "$val" | sed 's/[\/&]/\\&/g')
        sed -i "s|^$key=.*|$key=$SAFE_NEW_VALUE|#" "$CONFIG_FILE_ENV"
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
        rm "$CONFIG_FILE_ENV.bak"
        bright_green "配置已保存，正在重启服务..."
        restart_service
        sleep 1
        return 0
    }

    validate_port() {
        local val=$1
        if ! [[ "$val" =~ ^[0-9]+$ ]] || [ "$val" -lt 1 ] || [ "$val" -gt 65535 ]; then
            red "错误: 端口必须是 1-65535 的有效数字。"
            return 1
        fi
        local CURRENT_PORT=$(grep '^PORT=' "$CONFIG_FILE_ENV" | cut -d '=' -f 2 | tr -d '\r')
        if [ "$val" != "$CURRENT_PORT" ] && lsof -i:"$val" &>/dev/null; then
            red "错误: 端口 $val 已被占用。"
            return 1
        fi
        return 0
    }

    while true; do
        printf "\033c"; reload_config
        echo -e "${CYAN}========== 修改配置 ==========${RESET}"
        echo -e "${GREEN}1.${RESET} HTTP服务端口 : $(green "$PORT")"
        echo -e "${GREEN}2.${RESET} 书签管理密码 : $(green "********")"
        echo -e "${CYAN}----------------------------${RESET}"
        echo -e "${BRIGHT_GREEN}S.${RESET} 保存并重启服务"
        echo -e "${GREEN}0.${RESET} 返回主菜单"
        echo -e "${CYAN}==============================${RESET}"
        
        read -rp "$(yellow "请选择: ")" choice

        case $choice in
            1) 
                read -p "输入新 HTTP端口: " v
                if validate_port "$v"; then
                    update_config_value "PORT" "$v"
                fi
                ;;
            2) 
                read -s -p "输入新 管理密码: " v
                echo
                [ -n "$v" ] && update_config_value "ADMIN_PASSWORD" "$v"
                ;;
            [sS]) 
                save_and_restart 
                break 
                ;;
            0) 
                # 恢复备份文件
                mv "$CONFIG_FILE_ENV.bak" "$CONFIG_FILE_ENV"
                break
                ;;
            *) 
                red "无效选项" 
                sleep 0.5 
                ;;
        esac
    done
}

main() {
    clear
    check_root
    check_system
    check_dependencies

    while true; do
        clear
        echo -e "${CYAN}=================================${RESET}"
        echo -e "${CYAN}    node-nav 管理脚本  ${RESET}"
        echo -e "${CYAN}=================================${RESET}"
        check_status_for_menu
        
        SERVICE_INSTALLED=false
        if [ -f "$SERVICE_FILE" ]; then
            SERVICE_INSTALLED=true
            install_option_text="重装服务"
            READ_PROMPT="请输入选项 [0-5]: "
        else
            install_option_text="安装服务"
            READ_PROMPT="请输入选项 [0-1]: "
        fi

        echo -e "${YELLOW}=== 基础功能 ===${RESET}"
        echo -e "${GREEN}1.${RESET} ${install_option_text}"

        if [ "$SERVICE_INSTALLED" = true ]; then
            echo -e "${GREEN}2.${RESET} 卸载服务"
            echo -e "${GREEN}3.${RESET} 重启服务"
            echo -e "${CYAN}---------------------------------${RESET}"
            echo -e "${YELLOW}=== 管理功能 ===${RESET}"
            echo -e "${GREEN}4.${RESET} 修改配置"
            echo -e "${GREEN}5.${RESET} 查看服务状态"
            echo -e "${CYAN}---------------------------------${RESET}"
        fi

        echo -e "${GREEN}0.${RESET} 退出脚本"
        echo -e "${CYAN}=================================${RESET}"
        
        read -rp "$(yellow "$READ_PROMPT")" num

        if [ "$SERVICE_INSTALLED" = false ] && [[ "$num" =~ ^[2-5]$ ]]; then
            red "无效选项"
            read -n 1 -s -r -p "按任意键返回主菜单..."
            echo ""
            continue
        fi

        case $num in
            1) install_service ;;
            2) uninstall_service ;;
            3) restart_service ;;
            4) edit_variables ;; 
            5) view_status ;; 
            0) exit 0 ;;
            *) red "无效选项" ;;
        esac
        
        [[ "$num" =~ ^[1-5]$ ]] && {
            read -n 1 -s -r -p "按任意键返回主菜单..."
            echo ""
        }
    done
}

main

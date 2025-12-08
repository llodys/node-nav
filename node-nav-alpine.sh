#!/bin/bash
set -e

APP_NAME="node-nav"
INSTALL_DIR="/opt/$APP_NAME"
LOG_FILE="/var/log/${APP_NAME}_install.log"
CONFIG_FILE_ENV="$INSTALL_DIR/config.env"
SERVICE_FILE="/etc/init.d/$APP_NAME" 
ZIP_URL="https://github.com/llodys/node-nav/releases/download/node-nav/node-nav.zip"
ZIP_FILE="/tmp/$APP_NAME.zip"

SHORTCUT_NAME="nav"
SHORTCUT_PATH="/usr/local/bin/$SHORTCUT_NAME"
SCRIPT_URL="https://raw.githubusercontent.com/llodys/node-nav/main/node-nav-alpine.sh"

OS_ID=""
PKG_MANAGER="apk"

RED='\033[1;31m'; GREEN='\033[1;32m'; BRIGHT_GREEN='\033[1;32m'; YELLOW='\033[1;33m'
CYAN='\033[1;36m'; WHITE='\033[1;37m'; RESET='\033[0m'

red() { echo -e "${RED}$1${RESET}"; }
green() { echo -e "${GREEN}$1${RESET}"; }
bright_green() { echo -e "${BRIGHT_GREEN}$1${RESET}"; }
yellow() { echo -e "${YELLOW}$1${RESET}"; }
cyan() { echo -e "${CYAN}$1${RESET}"; }
white() { echo -e "${WHITE}$1${RESET}"; }

load_existing_config() {
    if [ -f "$CONFIG_FILE_ENV" ]; then
        local TMP_ENV=$(mktemp)
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
    if [ "$(id -u)" -ne 0 ]; then
        red "错误: 此脚本需要 root 权限运行。"
        exit 1
    fi
}

check_system() {
    if [ -f /etc/os-release ]; then
        source /etc/os-release
        OS_ID=$ID
    elif [ -f /etc/alpine-release ]; then
        OS_ID="alpine"
    fi

    if [[ "$OS_ID" != "alpine" ]]; then
        yellow "警告: 检测到当前系统不是 Alpine Linux ($OS_ID)。"
        yellow "本脚本专为 Alpine 优化，建议在 Alpine 环境下运行。"
        sleep 2
    else
        white "检测到系统: $(green "Alpine Linux") | 包管理器: $(green "apk")"
    fi

    if ! command -v rc-service &>/dev/null; then
        red "错误: 未检测到 OpenRC (rc-service)。"
        yellow "Alpine 容器请确保安装了 openrc。"
        exit 1
    fi
}

check_dependencies() {
    local DEPS="bash curl unzip lsof"
    white "正在更新软件源并检查依赖: $DEPS..."
    
    # 确保依赖和基本工具存在 (bash, coreutils, util-linux 通常在基础镜像中，但为了脚本稳定，在此安装)
    apk update >> "$LOG_FILE" 2>&1
    if ! apk add $DEPS >> "$LOG_FILE" 2>&1; then
        red "错误: 依赖安装失败。请检查 $LOG_FILE"
        exit 1
    fi
}

install_nodejs() {
    if command -v node &>/dev/null; then
        white "检测 Node.js 版本: $(node -v)"
    else
        white "未检测到 Node.js，正在安装 (apk)..."
        # Node.js LTS (当前v20或v22)
        apk add nodejs npm >> "$LOG_FILE" 2>&1 
        if command -v node &>/dev/null; then
            green "Node.js 已安装: $(node -v)"
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
        if rc-service "$APP_NAME" status >/dev/null 2>&1; then
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

if [ "$(id -u)" -ne 0 ]; then
    echo -e "${RED}错误: 请以 root 权限运行此命令。${RESET}"
    exit 1
fi

SCRIPT_URL="https://raw.githubusercontent.com/llodys/node-nav/main/node-nav-alpine.sh"

echo -e "${CYAN}正在连接服务器获取最新管理脚本 (Alpine)...${RESET}"
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
    bright_green "开始安装 (Alpine/OpenRC模式)... 日志: $LOG_FILE"
    
    if [ -f "$SERVICE_FILE" ]; then
        rc-service "$APP_NAME" stop &>/dev/null || true
    fi
    
    install_nodejs
    
    white "创建专用非Root用户 '$APP_NAME'..."
    # adduser -D 不创建家目录，适用于服务用户
    id -u "$APP_NAME" &>/dev/null || adduser -D -s /sbin/nologin "$APP_NAME"

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

    white "创建 OpenRC 服务脚本..."
    
    cat > "$SERVICE_FILE" <<EOF
#!/sbin/openrc-run

name="$APP_NAME"
description="Nodejs Argo Service"
command="/usr/bin/env"
command_args="node $INSTALL_DIR/app.js"
command_background=true
pidfile="/run/${APP_NAME}.pid"
directory="$INSTALL_DIR"
command_user="$APP_NAME:$APP_NAME"
output_log="/var/log/${APP_NAME}.log"
error_log="/var/log/${APP_NAME}.err"

depend() {
    need net
    after firewall
}

start_pre() {
    # 注入环境变量
    if [ -f "$CONFIG_FILE_ENV" ]; then
        set -a
        source "$CONFIG_FILE_ENV"
        set +a
    fi
    # 确保日志文件存在且权限正确
    checkpath -f -o \$command_user /var/log/${APP_NAME}.log
    checkpath -f -o \$command_user /var/log/${APP_NAME}.err
}
EOF

    chmod +x "$SERVICE_FILE"
    
    white "配置开机自启并启动..."
    rc-update add "$APP_NAME" default >> "$LOG_FILE" 2>&1
    rc-service "$APP_NAME" start

    create_shortcut

    yellow "1.服务已安装完成！服务已启动并开机自启"
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
    
    rc-service "$APP_NAME" stop &>/dev/null || true
    rc-update del "$APP_NAME" default &>/dev/null || true
    rm -f "$SERVICE_FILE"
    
    pkill -u "$APP_NAME" || true
    # -f 强制删除用户和家目录 (但我们创建时就没有家目录)
    deluser "$APP_NAME" &>/dev/null || true 
    
    rm -rf "$INSTALL_DIR"

    if [ -f "$SHORTCUT_PATH" ]; then
        rm -f "$SHORTCUT_PATH"
        white "快捷命令已移除: $SHORTCUT_PATH"
    fi

    # 清理旧版快捷命令 (兼容性)
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
        red "错误: 服务文件不存在，请先执行安装。"
        return 1
    fi
    
    if rc-service "$APP_NAME" restart 2>/dev/null; then
        bright_green "服务已重启"
    else
        red "重启失败，请查看状态 (选项 5) 获取更多信息。"
    fi
}

view_status() {
    if [ ! -f "$SERVICE_FILE" ]; then
        red "错误: 服务文件不存在，请先执行安装。"
        return 1
    fi
    rc-service "$APP_NAME" status
    echo ""
    yellow "--- 错误日志末尾 ---"
    tail -n 5 "/var/log/${APP_NAME}.err" 2>/dev/null
}

edit_variables() {
    check_root
    [ ! -f "$CONFIG_FILE_ENV" ] && red "配置文件不存在，请先安装服务" && sleep 2 && return
    
    cp "$CONFIG_FILE_ENV" "$CONFIG_FILE_ENV.bak"

    update_config_value() {
        local key=$1
        local val=$2
        local SAFE_NEW_VALUE=$(echo "$val" | sed 's/[\/&]/\\&/g')
        # 使用 sed 确保键值对被正确更新
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
        echo -e "${CYAN}========== 修改基础配置 ==========${RESET}"
        echo -e "${GREEN}1.${RESET} HTTP服务端口 : $(green "$PORT")"
        echo -e "${GREEN}2.${RESET} 书签管理密码 : $(green "********")"
        echo -e "${CYAN}----------------------------${RESET}"
        echo -e "${BRIGHT_GREEN}S.${RESET} 保存并重启服务"
        echo -e "${GREEN}0.${RESET} 返回主菜单 (不保存)"
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
                [ $? -eq 0 ] && break 
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
        echo -e "${CYAN}    node-nav (alpine)     ${RESET}"
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
        
        [[ "$num" =~ ^[12345]$ ]] && {
            read -n 1 -s -r -p "按任意键返回主菜单..."
            echo ""
        }
    done
}

main

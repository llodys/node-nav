/**
 * js/login.js
 * 处理登录页面的交互逻辑、API请求和壁纸应用
 */

const pwdInput = document.getElementById('password');
const errorMsg = document.getElementById('error-msg');
const submitBtn = document.getElementById('btn-submit');
const loginCard = document.getElementById('login-card');

// 主题应用函数
function applyTheme(mode) {
    let isDark = false;
    if (mode === 'auto') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            isDark = true;
        }
    } else if (mode === 'dark') {
        isDark = true;
    }

    if (isDark) document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
}

// 应用壁纸函数 (支持玻璃态)
function applyWallpaper(url) {
    if (!url) {
        document.body.classList.remove('has-bg');
        document.body.style.backgroundImage = '';
        return;
    }
    document.body.style.backgroundImage = `url('${url}')`;
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundPosition = 'center center';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.classList.add('has-bg');
}

// 显示错误信息
function showError(text) {
    errorMsg.innerText = text;
    errorMsg.classList.add('show');
    pwdInput.classList.add('error');
    setTimeout(() => { pwdInput.classList.remove('error'); }, 400);
}

// 登录逻辑
async function performLogin() {
    const pwd = pwdInput.value;
    if(!pwd) { showError('请输入密码'); pwdInput.focus(); return; }

    submitBtn.disabled = true;
    submitBtn.innerText = '登录中...';

    try {
        const res = await fetch('/check-password', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password: pwd })
        });
        
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) throw new Error("Server error");

        const data = await res.json();

        if(data.success) {
            sessionStorage.setItem('auth_token', pwd);
            setTimeout(() => { window.location.href = '/admin'; }, 300);
        } else {
            showError('密码错误，请重试');
            pwdInput.value = ''; pwdInput.focus();
        }
    } catch(e) {
        console.error(e);
        showError('网络请求失败');
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerText = '登 录';
    }
}

// 页面加载初始化
window.addEventListener('load', async () => {
    try {
        // 静默请求配置
        const res = await fetch('/api/bookmarks');
        if(res.ok) {
            const data = await res.json();
            
            // 1. 同步主题
            const theme = (data.settings && data.settings.theme) ? data.settings.theme : 'auto';
            localStorage.setItem('node_nav_theme', theme); 
            applyTheme(theme);

            // 2. 应用壁纸
            if (data.settings && data.settings.bgUrl) {
                applyWallpaper(data.settings.bgUrl);
            }

            // 3. 更新标题
            const baseTitle = (data.settings && data.settings.siteTitle) ? data.settings.siteTitle : 'Node Nav';
            document.title = baseTitle + ' - 登录'; 
            
            const titleDiv = document.querySelector('.login-title');
            if(titleDiv) {
                titleDiv.innerHTML = '<span>⚡</span> ' + baseTitle;
            }
        }
    } catch(e) {
        console.log('获取数据失败，使用默认设置');
    } finally {
        setTimeout(() => {
            if(loginCard) {
                loginCard.style.opacity = '1';
                loginCard.style.transform = 'translateY(0)';
                setTimeout(() => {
                    if(pwdInput) pwdInput.focus();
                }, 500);
            }
        }, 100); 
    }
});

// 输入框事件监听
pwdInput.addEventListener('input', () => {
    errorMsg.classList.remove('show');
    pwdInput.classList.remove('error');
});

pwdInput.addEventListener('keyup', function(e) {
    if (e.key === 'Enter') performLogin();
});
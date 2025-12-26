/**
 * js/index.js
 * 功能：前台渲染、搜索、离线数据、XSS防护、壁纸亮度智能检测、分列式菜单交互
 */

let allBookmarksData = {};
let flatBookmarksList = []; 
let currentCategory = ''; 

// SVG 图标常量
const folderIconSvg = `<svg class="category-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
const mobileFolderIconSvg = `<svg class="mobile-cat-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;
const chevronDownSvg = `<svg class="mobile-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;"><polyline points="6 9 12 15 18 9"></polyline></svg>`;

// --- 默认演示数据 ---
const MOCK_DATA = {
    "常用推荐": [
        { "name": "Google", "url": "https://www.google.com", "icon": "https://www.google.com/favicon.ico" },
        { "name": "GitHub", "url": "https://github.com", "icon": "https://github.com/favicon.ico" },
        { "name": "Bilibili", "url": "https://www.bilibili.com", "icon": "https://www.bilibili.com/favicon.ico" }
    ],
    "工具 / 开发": [
        { "name": "ChatGPT", "url": "https://chat.openai.com", "icon": "" },
        { "name": "Stack Overflow", "url": "https://stackoverflow.com", "icon": "" }
    ],
    "娱乐": [
        { "name": "YouTube", "url": "https://www.youtube.com", "icon": "" }
    ],
    "settings": {
        "siteTitle": "我的导航 (离线模式)",
        "theme": "auto"
    }
};

// === 工具函数区 ===

function escapeHtml(text) {
    if (!text) return "";
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function checkImageBrightness(imageSrc) {
    const img = new Image();
    img.crossOrigin = "Anonymous"; 
    img.src = imageSrc;
    img.onload = function() {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, 1, 1);
        try {
            const p = ctx.getImageData(0, 0, 1, 1).data;
            const brightness = (p[0] * 0.299 + p[1] * 0.587 + p[2] * 0.114);
            if (brightness > 180) {
                document.body.classList.add('is-light-bg');
            } else {
                document.body.classList.remove('is-light-bg');
            }
        } catch (e) {
            console.warn('无法分析背景亮度(跨域限制)，默认使用深色背景策略');
            document.body.classList.remove('is-light-bg');
        }
    };
    img.onerror = function() { document.body.classList.remove('is-light-bg'); };
}

// === 核心功能 ===

function applyTheme(mode) {
    let isDark = false;
    if (mode === 'auto') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) isDark = true;
    } else if (mode === 'dark') isDark = true;
    
    document.body.classList.remove('dark-mode');
    if (isDark) document.body.classList.add('dark-mode');
}

function applyWallpaper(url) {
    if (!url) {
        document.body.classList.remove('has-custom-bg');
        document.body.classList.remove('is-light-bg');
        document.body.style.backgroundImage = '';
        return;
    }
    document.body.style.backgroundImage = `url('${url}')`;
    document.body.style.backgroundRepeat = 'no-repeat';
    document.body.style.backgroundPosition = 'center center';
    document.body.style.backgroundSize = 'cover';
    document.body.style.backgroundAttachment = 'fixed';
    document.body.classList.add('has-custom-bg');
    
    checkImageBrightness(url);
}

function searchBookmarks(query) {
    if (!query || query.length < 1) {
        switchCategory(currentCategory); 
        return;
    }
    const lowerCaseQuery = query.toLowerCase();
    const results = flatBookmarksList.filter(item => 
        (item.name && item.name.toLowerCase().includes(lowerCaseQuery)) ||
        (item.url && item.url.toLowerCase().includes(lowerCaseQuery))
    );
    renderBookmarksGrid(results, query);
}

// 辅助：清空搜索框并重置列表
function clearSearchAndReset() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.value = ''; // 清空视觉文字
        searchInput.blur();     // 移除焦点（收起键盘）
        switchCategory(currentCategory); // 恢复当前分类的显示
    }
}

function toggleMobileMenu() {
    const overlay = document.getElementById('mobile-menu-overlay');
    const menuBtn = document.querySelector('.mobile-menu-btn');
    if (overlay) {
        const isShowing = overlay.classList.contains('show');
        if (isShowing) {
            overlay.classList.remove('show');
            document.body.style.overflow = '';
            if (menuBtn) menuBtn.classList.remove('is-open');
        } else {
            overlay.classList.add('show');
            document.body.style.overflow = 'hidden'; 
            if (menuBtn) menuBtn.classList.add('is-open');
        }
    }
}

function renderMobileMenu(keys) {
    const container = document.getElementById('mobile-menu-content');
    if (!container) return;
    container.innerHTML = '';

    const groups = {};
    keys.forEach(key => {
        const rootName = key.includes(' / ') ? key.split(' / ')[0] : key;
        if (!groups[rootName]) groups[rootName] = [];
        groups[rootName].push(key);
    });

    Object.keys(groups).forEach(rootName => {
        const groupKeys = groups[rootName];
        const subKeys = groupKeys.filter(k => k !== rootName);
        
        const parentDiv = document.createElement('div');
        parentDiv.className = 'mobile-group-container'; 

        const headerDiv = document.createElement('div');
        headerDiv.className = 'mobile-group-header';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'mobile-header-text';
        titleDiv.innerHTML = `${mobileFolderIconSvg}<span>${rootName}</span>`;
        titleDiv.onclick = (e) => {
            e.stopPropagation();
            switchCategory(rootName);
            highlightNavMobile(headerDiv);
            toggleMobileMenu();
            clearSearchAndReset();
        };
        headerDiv.appendChild(titleDiv);

        if (subKeys.length > 0) {
            const arrowDiv = document.createElement('div');
            arrowDiv.className = 'mobile-arrow-area'; 
            arrowDiv.innerHTML = chevronDownSvg;
            arrowDiv.onclick = (e) => {
                e.stopPropagation();
                parentDiv.classList.toggle('expanded');
            };
            headerDiv.appendChild(arrowDiv);

            const subMenuDiv = document.createElement('div');
            subMenuDiv.className = 'mobile-submenu';
            
            subKeys.forEach(subKey => {
                const subItem = document.createElement('div');
                subItem.className = 'mobile-cat-item sub-item';
                const simpleName = subKey.split(' / ')[1];
                subItem.innerHTML = `${mobileFolderIconSvg}<span>${simpleName}</span>`;
                
                subItem.onclick = (e) => {
                    e.stopPropagation();
                    switchCategory(subKey);
                    highlightNavMobile(subItem);
                    toggleMobileMenu();
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                    clearSearchAndReset();
                };
                subMenuDiv.appendChild(subItem);
            });
            parentDiv.appendChild(headerDiv);
            parentDiv.appendChild(subMenuDiv);
        } else {
            parentDiv.appendChild(headerDiv);
        }
        container.appendChild(parentDiv);
    });
}

function highlightNavMobile(targetEl) {
    document.querySelectorAll('.mobile-cat-item, .mobile-group-header').forEach(el => el.classList.remove('active'));
    if(targetEl) targetEl.classList.add('active');
}

async function initApp() {
    const container = document.getElementById('bookmarks-container');
    const inlineLoader = document.getElementById('inline-loader');
    const mainContent = document.getElementById('main-content');
    const mainTitle = document.getElementById('site-main-title');
    const searchForm = document.getElementById('search-form');
    const searchInput = document.getElementById('search-input');
    const overlay = document.getElementById('mobile-menu-overlay');
    const mobileContent = document.getElementById('mobile-menu-content');
    
    if(overlay) {
        overlay.addEventListener('click', function(e) {
            if(e.target === overlay) toggleMobileMenu();
        });
    }
    if(mobileContent) mobileContent.addEventListener('click', (e) => e.stopPropagation());

    try {
        let data;
        try {
            const response = await fetch('/api/bookmarks');
            if (!response.ok) throw new Error('API Failed');
            data = await response.json();
        } catch (fetchError) {
            console.warn('连接后台失败，加载默认演示数据...', fetchError);
            data = MOCK_DATA; 
        }
        
        allBookmarksData = data;
        flatBookmarksList = [];
        const ignoredKeysForFlatList = ['categories', 'adminAvatar', 'password', 'settings'];
        Object.keys(allBookmarksData).forEach(category => {
            if (!ignoredKeysForFlatList.includes(category) && Array.isArray(allBookmarksData[category])) {
                allBookmarksData[category].forEach(bookmark => {
                    flatBookmarksList.push({ ...bookmark, categoryName: category });
                });
            }
        });

        const siteTitle = (allBookmarksData.settings && allBookmarksData.settings.siteTitle) ? allBookmarksData.settings.siteTitle : 'Node Nav';
        document.title = siteTitle;
        if (mainTitle) mainTitle.textContent = siteTitle;
        
        const brandLink = document.querySelector('.navbar-brand');
        if (brandLink) {
            const iconSpan = brandLink.querySelector('span'); 
            brandLink.innerHTML = ''; 
            if(iconSpan) brandLink.appendChild(iconSpan); 
            brandLink.append(' ' + siteTitle);
        }

        const themeSetting = (allBookmarksData.settings && allBookmarksData.settings.theme) ? allBookmarksData.settings.theme : 'auto';
        localStorage.setItem('node_nav_theme', themeSetting);
        applyTheme(themeSetting);

        if (allBookmarksData.settings && allBookmarksData.settings.bgUrl) {
            applyWallpaper(allBookmarksData.settings.bgUrl);
        }
        
        const navContainer = document.getElementById('nav-categories');
        navContainer.innerHTML = '';
        const ignoredKeys = ['categories', 'adminAvatar', 'password', 'settings'];
        const rawKeys = Object.keys(allBookmarksData).filter(key => 
            !ignoredKeys.includes(key) && Array.isArray(allBookmarksData[key])
        );

        renderMobileMenu(rawKeys);
        createFloatingMenu(); 
        renderPcMenu(rawKeys, navContainer, searchInput); 

    } catch (error) { 
        console.error('致命错误:', error);
        container.innerHTML = `<p style="text-align:center; color:#999; margin-top:50px;">加载出错：${escapeHtml(error.message)}</p>`;
    } finally {
        if(inlineLoader) inlineLoader.style.display = 'none';
        
        // 动画：淡入并上滑 (Fade Slide Up)
        if(mainContent) {
             setTimeout(() => {
                 mainContent.classList.add('show');
             }, 100);
        }
    }

    if (searchForm && searchInput) {
        searchForm.addEventListener('submit', function(e) { 
            e.preventDefault(); 
            const query = searchInput.value.trim();
            
            // 如果搜索内容为空，触发震动动画
            if (!query) {
                const formContainer = document.querySelector('.search-form');
                if (formContainer) {
                    formContainer.classList.add('input-error-shake');
                    setTimeout(() => {
                        formContainer.classList.remove('input-error-shake');
                    }, 400);
                }
                return;
            }

            const hasResults = document.querySelector('.bookmark-card');
            
            if (!hasResults) {
                const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                window.open(googleUrl, '_blank');
                clearSearchAndReset();
            } else {
                searchInput.blur();
            }
        });
        
        const handleInput = debounce(function(e) {
            searchBookmarks(e.target.value.trim());
        }, 200);

        searchInput.addEventListener('input', handleInput);
        searchInput.addEventListener('focus', function() { if (this.value.trim()) searchBookmarks(this.value.trim()); });
    }
}

function createFloatingMenu() {
    let floatingMenu = document.getElementById('nav-floating-menu');
    if (!floatingMenu) {
        floatingMenu = document.createElement('div');
        floatingMenu.id = 'nav-floating-menu';
        floatingMenu.className = 'nav-floating-menu';
        document.body.appendChild(floatingMenu);
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.nav-dropdown-btn') && !e.target.closest('.nav-floating-menu')) {
                floatingMenu.classList.remove('show');
                document.querySelectorAll('.nav-dropdown-btn').forEach(b => b.classList.remove('open'));
            }
        });
    }
}

function renderPcMenu(rawKeys, navContainer, searchInput) {
    const groups = {}; 
    rawKeys.forEach(key => {
        const rootName = key.includes(' / ') ? key.split(' / ')[0] : key;
        if (!groups[rootName]) groups[rootName] = [];
        groups[rootName].push(key);
    });
    
    let firstCategoryToRender = null;
    let floatingMenu = document.getElementById('nav-floating-menu');

    Object.keys(groups).forEach(rootName => {
        const subKeys = groups[rootName];
        
        if (subKeys.length === 1 && subKeys[0] === rootName) {
            const btn = document.createElement('div');
            btn.className = 'nav-category-link';
            btn.innerHTML = `${folderIconSvg}<span class="nav-item-name">${rootName}</span>`;
            btn.onclick = (e) => {
                floatingMenu.classList.remove('show');
                document.querySelectorAll('.nav-dropdown-btn').forEach(b => b.classList.remove('open'));
                switchCategory(rootName);
                highlightNav(btn);
                clearSearchAndReset();
            };
            navContainer.appendChild(btn);
            if (!firstCategoryToRender) firstCategoryToRender = { type: 'link', el: btn, cat: rootName };
        } else {
            const wrapper = document.createElement('div');
            wrapper.className = 'nav-dropdown-wrapper';
            
            const btn = document.createElement('div');
            btn.className = 'nav-dropdown-btn';
            
            const arrowSvg = `<svg class="nav-arrow" viewBox="0 0 1024 1024" width="12" height="12"><path d="M858.9 352H165.1c-10.2 0-19.2 4.9-25.1 12.5-5.9 7.6-6.8 17.9-2.3 26.6l346.9 672.4c6.6 12.8 19.6 20.9 34 20.9s27.4-8.1 34-20.9l346.9-672.4c4.5-8.7 3.6-19-2.3-26.6-5.9-7.6-14.9-12.5-25.1-12.5z" fill="currentColor"/></svg>`;
            const arrowHtml = `<span class="nav-arrow-wrapper" title="展开菜单">${arrowSvg}</span>`;
            
            btn.innerHTML = `${folderIconSvg}<span class="nav-item-name">${rootName}</span>${arrowHtml}`;
            
            btn.onclick = (e) => {
                e.stopPropagation();
                const isArrowClick = e.target.closest('.nav-arrow-wrapper');
                
                if (isArrowClick) {
                    const isActive = btn.classList.contains('active');
                    const isMenuOpen = btn.classList.contains('open');
                    
                    document.querySelectorAll('.nav-dropdown-btn').forEach(b => { 
                        if(b !== btn) b.classList.remove('open'); 
                    });
                    
                    if (isMenuOpen) {
                        floatingMenu.classList.remove('show');
                        btn.classList.remove('open');
                    } else {
                        btn.classList.add('open');
                        showFloatingMenu(btn, subKeys, rootName);
                    }
                } else {
                    floatingMenu.classList.remove('show');
                    document.querySelectorAll('.nav-dropdown-btn').forEach(b => b.classList.remove('open'));
                    
                    switchCategory(rootName);
                    const nameSpan = btn.querySelector('.nav-item-name');
                    if(nameSpan) nameSpan.innerText = rootName;
                    
                    highlightNav(btn);
                    clearSearchAndReset();
                }
            };
            wrapper.appendChild(btn);
            navContainer.appendChild(wrapper);
            if (!firstCategoryToRender) firstCategoryToRender = { type: 'dropdown', el: btn, cat: subKeys[0] };
        }
    });

    if (firstCategoryToRender) {
        if (firstCategoryToRender.type === 'link') firstCategoryToRender.el.click();
        else { switchCategory(firstCategoryToRender.cat); highlightNav(firstCategoryToRender.el); }
    }
}

function showFloatingMenu(triggerBtn, keys, rootName) {
    const menu = document.getElementById('nav-floating-menu');
    const searchInput = document.getElementById('search-input');
    const rect = triggerBtn.getBoundingClientRect();
    menu.innerHTML = '';
    const subKeysOnly = keys.filter(key => key !== rootName);
    if (subKeysOnly.length === 0) return;
    subKeysOnly.forEach(key => {
        const item = document.createElement('div');
        item.className = 'nav-menu-item';
        const simpleName = key.split(' / ')[1];
        item.innerHTML = `${folderIconSvg}<span>${simpleName}</span>`;
        if (currentCategory === key) item.classList.add('active');
        item.onclick = (e) => {
            e.stopPropagation(); 
            switchCategory(key);
            highlightNav(triggerBtn);
            const textSpan = triggerBtn.querySelector('.nav-item-name');
            if(textSpan) textSpan.innerText = simpleName;
            
            menu.classList.remove('show');
            triggerBtn.classList.remove('open');
            clearSearchAndReset();
        };
        menu.appendChild(item);
    });
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const menuWidth = menu.offsetWidth;
    const btnCenter = rect.left + (rect.width / 2);
    let leftPos = btnCenter - (menuWidth / 2);
    if (leftPos < 10) leftPos = 10;
    menu.style.left = `${leftPos}px`;
    menu.style.top = `${rect.bottom + 5}px`;
    menu.style.visibility = '';
    menu.style.display = ''; 
    requestAnimationFrame(() => { menu.classList.add('show'); });
}

function highlightNav(targetEl) {
    document.querySelectorAll('.nav-category-link').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-dropdown-btn').forEach(el => el.classList.remove('active'));
    if (targetEl) targetEl.classList.add('active');
    document.querySelectorAll('.mobile-cat-item').forEach(item => {
        const itemText = item.innerText;
        const catText = currentCategory.includes(' / ') ? currentCategory.split(' / ')[1] : currentCategory;
        if(itemText === catText) item.classList.add('active');
    });
}

function renderBookmarksGrid(items, emptyMsgStr) {
    const container = document.getElementById('bookmarks-container');
    container.innerHTML = ''; 
    
    if (items.length === 0) {
         const encodedQuery = encodeURIComponent(emptyMsgStr || '');
         const googleUrl = `https://www.google.com/search?q=${encodedQuery}`;
         
         const msgHtml = emptyMsgStr 
            ? `没有找到匹配的书签，<a href="${googleUrl}" target="_blank" class="google-search-link" style="color:var(--primary-color);font-weight:600;text-decoration:none;">去 Google 搜索 "${escapeHtml(emptyMsgStr)}" &rarr;</a>` 
            : `暂无书签`;
            
         container.innerHTML = `<div style="text-align:center; margin-top:40px; color:var(--text-secondary); font-size: 0.9em;">${msgHtml}</div>`;
         
         const googleLink = container.querySelector('.google-search-link');
         if(googleLink) {
             googleLink.onclick = () => { clearSearchAndReset(); };
         }
         return;
    }

    const gridDiv = document.createElement('div');
    gridDiv.className = 'bookmark-grid';
    
    items.forEach(item => {
        const a = document.createElement('a');
        a.href = item.url; 
        a.className = 'bookmark-card';
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        
        a.onclick = () => {
            clearSearchAndReset();
        };
        
        const iconHtml = item.icon 
            ? `<img src="${item.icon}" loading="lazy" alt="icon" class="bookmark-icon" onerror="this.onerror=null;this.src='https://www.google.com/s2/favicons?domain=google.com'">` 
            : '<span>🔗</span>';
            
        let categoryTag = '';
        if (emptyMsgStr && item.categoryName) {
            const simpleCat = item.categoryName.split(' / ').pop();
            categoryTag = `<div class="bookmark-category-tag" title="${escapeHtml(simpleCat)}">${escapeHtml(simpleCat)}</div>`;
        }
        
        a.innerHTML = `${iconHtml}<div class="bookmark-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name || '未命名')}</div>${categoryTag}`;
        gridDiv.appendChild(a);
    });
    container.appendChild(gridDiv);
}

function switchCategory(categoryName) {
    currentCategory = categoryName; 
    const items = Array.isArray(allBookmarksData[categoryName]) ? allBookmarksData[categoryName] : [];
    renderBookmarksGrid(items);
}

document.addEventListener('DOMContentLoaded', initApp);
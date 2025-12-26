/**
 * js/admin.js - 侧边栏导航版 (v36.0)
 * 修改：switchView 更新侧边栏导航状态
 * 优化：增加移动端侧边栏滑动手势 & 震动反馈
 */

let bookmarksData = {};
let currentCategory = ''; 
let editMode = false;
let editTargetCat = '';
let editTargetIndex = -1;
const ignoredKeys = ['categories', 'adminAvatar', 'password', 'settings'];
const defaultIconSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="2" style="width:100%;height:100%"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
let bingCache = []; 

let catSortable = null;
let subSortables = [];
let bmSortable = null;
let saveTimeout = null;

// HTML 转义工具函数
function escapeHtml(text) {
    if (typeof text !== 'string') return text;
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

document.addEventListener('DOMContentLoaded', () => {
    loadData();

    // === 移动端侧边栏滑动手势 ===
    let touchStartX = 0;
    let touchEndX = 0;
    const sidebar = document.getElementById('sidebar');
    const swipeThreshold = 80; 

    document.addEventListener('touchstart', e => {
        touchStartX = e.changedTouches[0].screenX;
    }, {passive: true});

    document.addEventListener('touchend', e => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    }, {passive: true});

    function handleSwipe() {
        // 仅在移动端生效
        const isMobile = window.innerWidth <= 900;
        if (!isMobile) return;

        const swipeDistance = touchEndX - touchStartX;
        const sidebarActive = sidebar.classList.contains('active');

        // 1. 从左向右滑：打开侧边栏 (仅当在屏幕左侧边缘起滑时生效，避免误触)
        if (swipeDistance > swipeThreshold && touchStartX < 50 && !sidebarActive) {
            toggleSidebar();
        }
        
        // 2. 从右向左滑：关闭侧边栏
        if (swipeDistance < -swipeThreshold && sidebarActive) {
            toggleSidebar();
        }
    }
    // ==================================
    
    document.getElementById('bookmarkGrid').addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if(!btn) return;
        const action = btn.dataset.action;
        const cat = btn.dataset.cat;
        const index = parseInt(btn.dataset.index);
        if(action === 'edit') editBookmark(cat, index);
        if(action === 'delete') deleteBookmark(cat, index);
    });

    document.getElementById('catListContainer').addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        const item = e.target.closest('.menu-item');
        if (btn) {
            e.stopPropagation(); 
            const action = btn.dataset.action;
            const cat = btn.dataset.cat;
            if(action === 'edit') renameCategory(cat);
            if(action === 'delete') deleteCategory(cat);
            if(action === 'level-up') changeLevel(cat, 'up');
            if(action === 'level-down') changeLevel(cat, 'down');
            return; 
        }
        if (item) {
            const cat = item.getAttribute('data-id');
            if(cat) {
                currentCategory = cat; 
                switchView('bookmarks'); 
                renderUI();
                if(window.innerWidth<=900) toggleSidebar(); 
            }
        }
    });
});

// ============ Modal Logic ============
function openAddModal() {
    // 震动反馈
    if(window.navigator.vibrate) window.navigator.vibrate(15);
    resetForm(); 
    document.getElementById('modalTitle').innerText = "添加书签";
    document.getElementById('btnSaveAction').innerText = "保存";
    openModal();
}

function openModal() {
    const modal = document.getElementById('bookmarkModal');
    modal.classList.add('active');
    updateSelectOptions(); 
}

function closeModal() {
    const modal = document.getElementById('bookmarkModal');
    modal.classList.remove('active');
    if(editMode) resetForm(); 
}

// ============ CRUD Logic ============

function editBookmark(cat, index) {
    // 震动反馈
    if(window.navigator.vibrate) window.navigator.vibrate(15);
    
    const item = bookmarksData[cat][index];
    document.getElementById('inpName').value = item.name;
    document.getElementById('inpUrl').value = item.url;
    document.getElementById('inpIcon').value = item.icon || '';
    
    editMode = true; 
    editTargetCat = cat; 
    editTargetIndex = index;
    
    document.getElementById('modalTitle').innerText = "编辑书签";
    document.getElementById('btnSaveAction').innerText = "保存修改";
    
    updateSelectOptions();
    document.getElementById('inpCat').value = cat;

    openModal();
}

async function deleteBookmark(cat, index) {
    // 震动警告
    if(window.navigator.vibrate) window.navigator.vibrate([10, 30, 10]); 
    
    if(!confirm('删除书签？')) return;
    bookmarksData[cat].splice(index, 1);
    renderUI(); 
    await syncToServer();
}

async function addOrUpdateBookmark() {
    const nameInput = document.getElementById('inpName');
    const urlInput = document.getElementById('inpUrl');
    const catInput = document.getElementById('inpCat');
    const iconInput = document.getElementById('inpIcon');

    const name = nameInput.value.trim();
    let url = urlInput.value.trim();
    const icon = iconInput.value.trim();
    const cat = catInput.value;

    // === 验证失败触发震动 ===
    let hasError = false;

    if (!name) {
        shakeElement(nameInput);
        hasError = true;
    }
    if (!url) {
        shakeElement(urlInput);
        hasError = true;
    }
    if (!cat) {
        shakeElement(catInput);
        hasError = true;
    }

    if (hasError) {
        showToast('请完善必填项');
        return;
    }

    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    const targetList = bookmarksData[cat] || [];
    const isDuplicate = targetList.some((item, index) => {
        if (editMode && cat === editTargetCat && index === editTargetIndex) return false;
        return item.url === url;
    });

    if (isDuplicate) {
        showToast(`【${cat}】分类下已存在此网址！`);
        return; 
    }

    if (editMode && bookmarksData[editTargetCat]) {
        bookmarksData[editTargetCat].splice(editTargetIndex, 1);
    }

    if(!bookmarksData[cat]) bookmarksData[cat] = [];
    
    // unshift: 新增在顶部
    bookmarksData[cat].unshift({ name, url, icon });

    const btn = document.getElementById('btnSaveAction');
    const originalText = btn.innerText;
    btn.disabled = true; btn.innerText = "⏳ 处理中...";
    
    await syncToServer();
    
    closeModal(); 
    renderUI();
    
    btn.disabled = false; btn.innerText = originalText;
    resetForm();
}

function resetForm() {
    document.getElementById('inpName').value = ''; 
    document.getElementById('inpUrl').value = ''; 
    document.getElementById('inpIcon').value = '';
    
    editMode = false; 
    editTargetCat = ''; 
    editTargetIndex = -1;
    
    if(currentCategory !== 'all' && bookmarksData[currentCategory]) {
        const sel = document.getElementById('inpCat');
        if(sel) sel.value = currentCategory;
    }
}

// ============ Rendering & Categories ============

function renderCategories() {
    const container = document.getElementById('catListContainer');
    container.innerHTML = '';
    
    if (catSortable) { catSortable.destroy(); catSortable = null; }
    subSortables.forEach(s => s.destroy());
    subSortables = [];

    let keys = Object.keys(bookmarksData).filter(k => !ignoredKeys.includes(k));
    const groups = {};
    
    keys.forEach(key => {
        if (!key.includes(' / ')) {
            groups[key] = { root: key, children: [] };
        }
    });
    
    keys.forEach(key => {
        if (key.includes(' / ')) {
            const parts = key.split(' / ');
            const root = parts[0];
            if (groups[root]) {
                groups[root].children.push(key);
            } else {
                groups[key] = { root: key, children: [] };
            }
        }
    });

    const sortedRoots = keys.filter(k => !k.includes(' / '));

    sortedRoots.forEach(rootKey => {
        const groupData = groups[rootKey];
        if(!groupData) return;

        const groupDiv = document.createElement('div');
        groupDiv.className = 'cat-group';
        groupDiv.setAttribute('data-root-key', rootKey);

        groupDiv.appendChild(createCategoryItem(rootKey, false));

        const subContainer = document.createElement('div');
        subContainer.className = 'sub-cat-container';
        
        groupData.children.forEach(childKey => {
            subContainer.appendChild(createCategoryItem(childKey, true));
        });

        groupDiv.appendChild(subContainer);
        container.appendChild(groupDiv);

        const subSort = Sortable.create(subContainer, {
            group: 'nested-subs',
            handle: '.cat-handle',
            animation: 150,
            fallbackOnBody: true,
            swapThreshold: 0.65,
            ghostClass: 'sortable-ghost',
            onEnd: function(evt) { handleDragEnd(); } 
        });
        subSortables.push(subSort);
    });

    catSortable = Sortable.create(container, {
        animation: 150,
        draggable: '.cat-group', 
        handle: '.cat-handle',
        ghostClass: 'sortable-ghost',
        onEnd: function (evt) { handleDragEnd(); }
    });
}

function createCategoryItem(key, isSub) {
    const displayName = key.split(' / ').pop();
    const item = document.createElement('div');
    item.className = `menu-item ${currentCategory === key ? 'active' : ''} ${isSub ? 'sub-item' : ''}`;
    item.setAttribute('data-id', key);
    
    const levelBtn = isSub 
        ? `<button class="mini-btn move" data-action="level-up" data-cat="${key}" title="设为主分类">←</button>`
        : `<button class="mini-btn move" data-action="level-down" data-cat="${key}" title="设为子分类">→</button>`;

    const handleHtml = `
        <span class="cat-handle" title="按住拖动排序">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
            </svg>
        </span>
    `;

    item.innerHTML = `
        <svg class="menu-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        <span class="menu-text" title="${escapeHtml(key)}">${escapeHtml(displayName)}</span>
        <div class="menu-actions">
            ${handleHtml}
            ${levelBtn}
            <button class="mini-btn edit" data-action="edit" data-cat="${key}" title="重命名">✎</button>
            <button class="mini-btn del" data-action="delete" data-cat="${key}" title="删除">×</button>
        </div>
    `;
    return item;
}

async function handleDragEnd() {
    const newOrder = {};
    const container = document.getElementById('catListContainer');
    
    container.querySelectorAll('.cat-group').forEach(group => {
        const rootItem = group.querySelector('.menu-item:not(.sub-item)');
        if(!rootItem) return;

        const rootKey = rootItem.getAttribute('data-id');
        if (bookmarksData[rootKey]) {
            newOrder[rootKey] = bookmarksData[rootKey];
        }

        const subItems = group.querySelectorAll('.sub-cat-container .menu-item');
        subItems.forEach(subItem => {
            const oldSubKey = subItem.getAttribute('data-id');
            const simpleName = oldSubKey.split(' / ').pop();
            const newSubKey = `${rootKey} / ${simpleName}`;
            
            if (oldSubKey !== newSubKey && bookmarksData[oldSubKey]) {
                 bookmarksData[newSubKey] = bookmarksData[oldSubKey];
                 subItem.setAttribute('data-id', newSubKey);
                 subItem.querySelectorAll('[data-cat]').forEach(btn => btn.setAttribute('data-cat', newSubKey));
            }
            
            if(bookmarksData[newSubKey] || bookmarksData[oldSubKey]) {
                newOrder[newSubKey] = bookmarksData[newSubKey] || bookmarksData[oldSubKey];
            }
        });
    });
    
    ignoredKeys.forEach(k => { if(bookmarksData[k]) newOrder[k] = bookmarksData[k]; });
    
    bookmarksData = newOrder;
    debouncedSync();
}

async function changeLevel(key, direction) {
    const simpleName = key.split(' / ').pop();
    let newKey = '';

    if (direction === 'up') {
        newKey = simpleName;
    } else {
        const keys = Object.keys(bookmarksData).filter(k => !ignoredKeys.includes(k));
        const currentIndex = keys.indexOf(key);
        if (currentIndex <= 0) return showToast('已经是第一个，无法降级');
        
        const prevKey = keys[currentIndex - 1];
        const parentRoot = prevKey.split(' / ')[0];
        newKey = `${parentRoot} / ${simpleName}`;
    }

    if (bookmarksData[newKey]) return showToast('目标层级已存在同名分类');

    const newOrder = {};
    Object.keys(bookmarksData).forEach(k => {
        if (k === key) {
            newOrder[newKey] = bookmarksData[k];
        } else if (k.startsWith(key + ' / ')) {
            newOrder[k] = bookmarksData[k];
        } else {
            newOrder[k] = bookmarksData[k];
        }
    });

    bookmarksData = newOrder;
    if (currentCategory === key) currentCategory = newKey;
    
    renderUI();
    await syncToServer();
}

async function renameCategory(oldName) {
    const simpleName = oldName.split(' / ').pop();
    const newSimpleName = prompt('重命名:', simpleName);
    if (!newSimpleName || newSimpleName === simpleName) return;
    
    if (newSimpleName.includes('/')) return alert('分类名称不能包含 "/" 符号');

    let newName = newSimpleName;
    if (oldName.includes(' / ')) {
        const parent = oldName.split(' / ')[0];
        newName = `${parent} / ${newSimpleName}`;
    }

    if (bookmarksData[newName]) return alert('分类名已存在');

    const newOrder = {};
    Object.keys(bookmarksData).forEach(key => {
        if (key === oldName) {
            newOrder[newName] = bookmarksData[key];
        } else {
            newOrder[key] = bookmarksData[key];
        }
    });

    bookmarksData = newOrder;
    if (currentCategory === oldName) currentCategory = newName;
    
    renderUI();
    await syncToServer();
}

async function addCategory() {
    const name = document.getElementById('newCatName').value.trim();
    if (!name) return showToast('请输入分类名称');
    if (name.includes('/')) return showToast('分类名称不能包含 "/" 符号');
    if (bookmarksData[name]) return showToast('分类已存在');
    
    bookmarksData[name] = [];
    document.getElementById('newCatName').value = '';
    currentCategory = name;
    switchView('bookmarks'); 
    
    renderUI();
    await syncToServer();
}

async function deleteCategory(cat) {
    const count = bookmarksData[cat] ? bookmarksData[cat].length : 0;
    const hasSub = Object.keys(bookmarksData).some(k => k.startsWith(cat + ' / '));
    
    let msg = `删除【${cat}】？`;
    if (hasSub) msg += `\n注意：这将同时删除其下所有子分类！`;
    else if (count > 0) msg += `\n该分类下有 ${count} 个书签。`;
    
    if (!confirm(msg)) return;
    
    const newOrder = {};
    Object.keys(bookmarksData).forEach(key => {
        if (key === cat || key.startsWith(cat + ' / ')) {
            // Skip
        } else {
            newOrder[key] = bookmarksData[key];
        }
    });
    bookmarksData = newOrder;

    const cats = Object.keys(bookmarksData).filter(k => !ignoredKeys.includes(k));
    currentCategory = cats.length > 0 ? cats[0] : 'all';
    renderUI();
    await syncToServer();
}

// ============ View Switching Logic ============

function switchView(viewName) {
    // 1. 隐藏所有视图
    document.querySelectorAll('.view-section').forEach(el => el.classList.remove('active'));
    
    // 2. 更新侧边栏【主导航】的激活状态 (新增逻辑)
    // 先移除所有激活状态
    const navSettings = document.getElementById('nav-item-settings');
    const navBookmarks = document.getElementById('nav-item-bookmarks');
    if(navSettings) navSettings.classList.remove('active');
    if(navBookmarks) navBookmarks.classList.remove('active');

    const fab = document.getElementById('fab-add');
    const catManager = document.getElementById('sidebar-cat-manager');
    const settingsNav = document.getElementById('sidebar-settings-nav');

    if(viewName === 'bookmarks') {
        document.getElementById('view-bookmarks').classList.add('active');
        
        // 激活侧边栏“书签管理”按钮
        if(navBookmarks) navBookmarks.classList.add('active');

        // 书签页：显示添加按钮、显示分类管理、隐藏设置导航
        if(fab) fab.style.display = 'flex';
        if(catManager) catManager.style.display = 'block';
        if(settingsNav) settingsNav.style.display = 'none';

        if (currentCategory !== 'all') {
            const activeEl = document.querySelector(`.menu-item[data-id="${currentCategory}"]`);
            if(activeEl) activeEl.classList.add('active');
        }
    } 
    else if (viewName === 'settings') {
        document.getElementById('view-settings').classList.add('active');
        
        // 激活侧边栏“系统设置”按钮
        if(navSettings) navSettings.classList.add('active');

        // 设置页：隐藏添加按钮、隐藏分类管理、显示设置导航
        if(fab) fab.style.display = 'none';
        if(catManager) catManager.style.display = 'none';
        if(settingsNav) settingsNav.style.display = 'block';
        
        // 默认激活“基本设置”页面
        const basicBtn = document.getElementById('btn-set-basic');
        switchSettingSubView('set-basic', basicBtn); 

        loadBingImages();
        const currentTitle = (bookmarksData.settings && bookmarksData.settings.siteTitle) ? bookmarksData.settings.siteTitle : '';
        document.getElementById('sys-site-title').value = currentTitle;
        updateThemeUI(bookmarksData.settings?.theme || 'auto');
        if(bookmarksData.settings?.bgUrl) {
            document.getElementById('custom-bg-url').value = bookmarksData.settings.bgUrl;
        } else {
            document.getElementById('custom-bg-url').value = '';
        }
    } 

    if(window.innerWidth <= 900) toggleSidebar(); 
}

// 新增：切换设置子页面
function switchSettingSubView(targetId, btn) {
    // 隐藏所有设置卡片
    ['set-basic', 'set-theme', 'set-wallpaper'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.style.display = 'none';
    });

    // 显示目标卡片
    const target = document.getElementById(targetId);
    if(target) target.style.display = 'block';

    // 更新侧边栏选中状态
    if(btn) {
        document.querySelectorAll('#sidebar-settings-nav .menu-item').forEach(el => el.classList.remove('active'));
        btn.classList.add('active');
    }
}

function handleMenuClick(type, el) {
    if (type === 'bookmarks') {
        filterBookmarks('all'); 
        switchView('bookmarks');
    } else if (type === 'settings') {
        switchView('settings');
    }
}

async function setTheme(mode) {
    if (!bookmarksData.settings) bookmarksData.settings = {};
    bookmarksData.settings.theme = mode;
    updateThemeUI(mode);
    applyTheme(mode);
    await syncToServer(false);
    showToast('主题设置已保存');
}

async function saveWallpaper() {
    const url = document.getElementById('custom-bg-url').value.trim();
    if (!url) return showToast('请输入图片地址');
    
    if (!bookmarksData.settings) bookmarksData.settings = {};
    bookmarksData.settings.bgUrl = url;
    
    applyWallpaper(url);
    
    await syncToServer(false);
    showToast('壁纸已应用');
}

async function clearWallpaper() {
    document.getElementById('custom-bg-url').value = '';
    if (bookmarksData.settings) {
        delete bookmarksData.settings.bgUrl;
    }
    document.body.style.backgroundImage = '';
    document.body.classList.remove('has-bg');
    
    await syncToServer(false);
    showToast('壁纸已清除');
}

async function loadBingImages() {
    const grid = document.getElementById('bing-grid');
    const loading = document.getElementById('bing-loading');
    
    if(bingCache.length > 0) {
        renderBingGrid(bingCache);
        return;
    }

    grid.innerHTML = '';
    loading.style.display = 'block';

    try {
        const requests = [];
        // 获取 8 张图片
        for (let i = 0; i < 8; i++) {
            const url = `https://bing.biturl.top/?resolution=1920&format=json&index=${i}&mkt=zh-CN`;
            requests.push(fetch(url).then(res => res.json()));
        }

        const results = await Promise.all(requests);
        
        bingCache = results.map((data, idx) => ({
            url: data.url,
            date: data.start_date || `Day -${idx}`,
            copyright: data.copyright || 'Bing Wallpaper'
        }));

        renderBingGrid(bingCache);

    } catch (e) {
        console.error(e);
        grid.innerHTML = `<div style="grid-column:1/-1; color:#e53e3e; font-size:0.8rem; text-align:center;">获取 Bing 图片失败，请检查网络。</div>`;
    } finally {
        loading.style.display = 'none';
    }
}

function renderBingGrid(images) {
    const grid = document.getElementById('bing-grid');
    grid.innerHTML = '';

    images.forEach(img => {
        const div = document.createElement('div');
        div.className = 'bing-item';
        div.title = img.copyright;
        div.innerHTML = `<img src="${img.url}" loading="lazy">`;
        
        div.onclick = () => {
            document.querySelectorAll('.bing-item').forEach(el => el.classList.remove('selected'));
            div.classList.add('selected');
            document.getElementById('custom-bg-url').value = img.url;
        };
        grid.appendChild(div);
    });
}

function applyWallpaper(url) {
    if (url) {
        document.body.style.backgroundImage = `url('${url}')`;
        document.body.classList.add('has-bg');
    } else {
        document.body.style.backgroundImage = '';
        document.body.classList.remove('has-bg');
    }
}

async function saveSystemSettings() {
    const titleInput = document.getElementById('sys-site-title');
    const newTitle = titleInput.value.trim();

    if (!bookmarksData.settings) bookmarksData.settings = {};
    bookmarksData.settings.siteTitle = newTitle;
    
    const sidebarLogoText = document.querySelector('.sidebar-header .logo-text');
    const baseTitle = newTitle || 'Node Nav';
    if (sidebarLogoText) {
        sidebarLogoText.innerText = baseTitle;
    }
    document.title = baseTitle + ' - 管理';
    await syncToServer(false); 
    showToast('系统设置已保存');
}

function updateThemeUI(mode) {
    document.querySelectorAll('.theme-card').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`theme-opt-${mode}`);
    if (target) target.classList.add('active');
}

function applyTheme(mode) {
    let isDark = false;
    if (mode === 'auto') {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) isDark = true;
    } else if (mode === 'dark') isDark = true;
    if (isDark) document.body.classList.add('dark-mode');
    else document.body.classList.remove('dark-mode');
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    document.getElementById('toastMsg').innerText = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2000);
}

function debouncedSync() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        await syncToServer(false);
    }, 1000); 
}

function toggleSidebar() {
    // 震动反馈
    if(window.navigator.vibrate) window.navigator.vibrate(10);
    document.getElementById('sidebar').classList.toggle('active');
    document.querySelector('.sidebar-overlay').classList.toggle('active');
}

async function loadData() {
    const wrapper = document.getElementById('admin-wrapper');
    try {
        const res = await fetch('/api/bookmarks');
        const data = await res.json();
        bookmarksData = data.error ? { "常用": [] } : data;
        
        if (!bookmarksData.settings) bookmarksData.settings = { theme: 'auto' };
        
        applyTheme(bookmarksData.settings.theme);
        if(bookmarksData.settings.bgUrl) {
            applyWallpaper(bookmarksData.settings.bgUrl);
        }

        const currentSiteTitle = (bookmarksData.settings && bookmarksData.settings.siteTitle) ? bookmarksData.settings.siteTitle : 'Node Nav';
        document.title = currentSiteTitle + ' - 管理';
        const sidebarLogoText = document.querySelector('.sidebar-header .logo-text');
        if (sidebarLogoText) {
            sidebarLogoText.innerText = currentSiteTitle;
        }

        const cats = Object.keys(bookmarksData).filter(k => !ignoredKeys.includes(k));
        if (!currentCategory || !bookmarksData[currentCategory]) {
             currentCategory = cats.length > 0 ? cats[0] : 'all';
        }
        
        renderUI();
    } catch(e) { 
        console.error(e); 
        showToast('数据加载失败'); 
    } finally {
        setTimeout(() => {
            if(wrapper) {
                // 使用 class 触发 CSS 动画
                wrapper.classList.add('show');
            }
        }, 100);
    }
}

function renderUI() {
    requestAnimationFrame(() => {
        renderCategories();
        renderGrid();
        updateSelectOptions();
        
        if (document.getElementById('view-bookmarks').classList.contains('active')) {
            const isAll = (currentCategory === 'all');
            document.querySelectorAll('.menu-item').forEach(el => el.classList.remove('active'));
            // 确保主菜单保持激活
            const navBookmarks = document.getElementById('nav-item-bookmarks');
            if(navBookmarks) navBookmarks.classList.add('active');

            if(isAll) {
                // menu-bookmarks 已删除
            } else {
                const activeEl = document.querySelector(`.menu-item[data-id="${currentCategory}"]`);
                if(activeEl) activeEl.classList.add('active');
            }
        } else if (document.getElementById('view-settings').classList.contains('active')) {
            const navSettings = document.getElementById('nav-item-settings');
            if(navSettings) navSettings.classList.add('active');
        }
    });
}

async function syncToServer(showSuccessToast = true) {
    const token = sessionStorage.getItem('auth_token'); // Get token locally
    try {
        const res = await fetch('/api/bookmarks', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ password: token, bookmarksData: bookmarksData })
        });
        const data = await res.json();
        if(!data.success) {
            showToast('保存失败: ' + data.message);
        } else if(showSuccessToast) {
            showToast('已保存');
        }
    } catch(e) { showToast('网络错误'); }
}

function renderGrid() {
    const grid = document.getElementById('bookmarkGrid');
    const fragment = document.createDocumentFragment();
    const canSort = (currentCategory !== 'all');
    let hasItems = false;
    
    const appendCards = (items, catName) => {
        if(items && items.length > 0) {
            hasItems = true;
            items.forEach((item, index) => {
                const card = createCard(item.name, item.url, item.icon, catName, index, canSort);
                fragment.appendChild(card);
            });
        }
    };

    if (canSort) appendCards(bookmarksData[currentCategory], currentCategory);
    else Object.entries(bookmarksData).forEach(([cat, items]) => { if (!ignoredKeys.includes(cat)) appendCards(items, cat); });

    grid.innerHTML = '';
    if (!hasItems) grid.innerHTML = `<div class="empty-state">暂无书签，快去添加一个吧！</div>`;
    else grid.appendChild(fragment);

    if (bmSortable) { bmSortable.destroy(); bmSortable = null; }

    if (canSort && hasItems && typeof Sortable !== 'undefined') {
        bmSortable = Sortable.create(grid, {
            animation: 200,
            handle: '.drag-handle',
            ghostClass: 'sortable-ghost',
            dragClass: 'sortable-drag',
            delay: 0, forceFallback: true, fallbackOnBody: true, swapThreshold: 0.65,
            onEnd: function (evt) {
                const arr = bookmarksData[currentCategory];
                const item = arr.splice(evt.oldIndex, 1)[0];
                arr.splice(evt.newIndex, 0, item);
                debouncedSync();
            }
        });
    }
}

function createCard(name, url, icon, cat, index, canSort) {
    const card = document.createElement('div');
    card.className = 'bm-card';
    
    const hasIcon = icon && icon.trim() !== '';
    const imgStyle = hasIcon ? '' : 'display:none';
    const svgStyle = hasIcon ? 'display:none' : 'display:block';
    
    const dragHandleHtml = canSort ? `
        <div class="drag-handle" title="按住拖动排序">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="19" r="1"></circle>
                <circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="19" r="1"></circle>
            </svg>
        </div>
    ` : '';

    card.innerHTML = `
        ${dragHandleHtml}
        <div class="bm-icon-box">
            <img src="${hasIcon ? icon : ''}" class="bm-icon" loading="lazy" 
                 referrerpolicy="no-referrer"
                 style="${imgStyle}"
                 onerror="this.style.display='none'; this.nextElementSibling.style.display='block'">
            <div style="${svgStyle}; width:100%; height:100%;">${defaultIconSvg}</div>
        </div>
        <div class="bm-title" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <div class="bm-actions">
            <button class="bm-btn bm-btn-edit" data-action="edit" data-cat="${cat}" data-index="${index}">编辑</button>
            <button class="bm-btn bm-btn-del" data-action="delete" data-cat="${cat}" data-index="${index}">删除</button>
        </div>
    `;
    return card;
}

function filterBookmarks(cat) { 
    currentCategory = cat; 
    switchView('bookmarks'); 
    renderUI(); 
}

function updateSelectOptions() {
    const select = document.getElementById('inpCat');
    const currentVal = select.value; 
    select.innerHTML = '';
    Object.keys(bookmarksData).forEach(cat => {
        if (ignoredKeys.includes(cat)) return;
        const opt = document.createElement('option');
        opt.value = cat; opt.innerText = cat;
        select.appendChild(opt);
    });
    if(editMode) select.value = currentVal;
    else if(currentCategory !== 'all' && bookmarksData[currentCategory]) select.value = currentCategory;
}

function autoParseUrl() {
    const urlInput = document.getElementById('inpUrl');
    const iconInput = document.getElementById('inpIcon');
    const nameInput = document.getElementById('inpName');
    let url = urlInput.value.trim();
    if (!url) return;
    
    if (!/^https?:\/\//i.test(url)) { 
        url = 'https://' + url; 
        urlInput.value = url; 
    }
    
    if (!iconInput.value || iconInput.value.includes('google.com/s2/favicons')) {
        try {
            const domain = new URL(url).hostname;
            iconInput.value = `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url)}&size=256`;
            
            if(!nameInput.value) {
                 const parts = domain.split('.');
                 if (parts.length > 2) {
                     nameInput.value = parts[parts.length - 2]; 
                 } else if (parts.length === 2) {
                     nameInput.value = parts[0];
                 }
                 if(nameInput.value) {
                     nameInput.value = nameInput.value.charAt(0).toUpperCase() + nameInput.value.slice(1);
                 }
            }
        } catch (e) {
            console.warn('URL Parse Error:', e);
        }
    }
}

function exportBookmarks() {
    if (!confirm('确定要导出当前书签备份吗？')) return;

    const dataStr = JSON.stringify(bookmarksData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `node-nav-backup-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('已导出书签备份');
}

function triggerImport() {
    document.getElementById('importFileBtn').click();
}

function handleImportFile(input) {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const json = JSON.parse(e.target.result);
            
            if (typeof json !== 'object' || json === null) {
                throw new Error('无效的 JSON 格式');
            }

            if(confirm('警告：导入将覆盖当前所有书签和设置！\n\n建议先导出备份。\n确定要继续吗？')) {
                bookmarksData = json;
                
                if (!bookmarksData.settings) {
                    bookmarksData.settings = { theme: 'auto' };
                }

                renderUI();
                
                if (bookmarksData.settings && bookmarksData.settings.theme) {
                    applyTheme(bookmarksData.settings.theme);
                    updateThemeUI(bookmarksData.settings.theme);
                }
                
                if(bookmarksData.settings.bgUrl) {
                    applyWallpaper(bookmarksData.settings.bgUrl);
                }

                await syncToServer();
                showToast('导入成功，页面即将刷新');
                
                setTimeout(() => window.location.reload(), 1500);
            }
        } catch (err) {
            console.error(err);
            alert('导入失败：文件格式不正确或已损坏。');
        } finally {
            input.value = '';
        }
    };
    reader.readAsText(file);
}

function logout() {
    if(confirm('退出登录？')) { sessionStorage.removeItem('auth_token'); window.location.href = '/login'; }
}

// 辅助函数：触发震动动画
function shakeElement(element) {
    element.classList.add('input-error-shake');
    element.focus();
    setTimeout(() => {
        element.classList.remove('input-error-shake');
    }, 400);
}
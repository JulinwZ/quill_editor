/* ==========================================================================
   База знаний — Клиентская логика (Quill.js + Flask)
   ========================================================================== */

// 1. Инициализация редактора Quill.js с поддержкой списков задач (чекбоксов)
const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: 'Нажмите сюда для ввода текста документа...',
    modules: {
        toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            [{ 'list': 'ordered'}, { 'list': 'bullet'}, { 'list': 'check' }],
            [{ 'color': [] }, { 'background': [] }],
            ['clean']
        ]
    }
});

// Глобальное состояние приложения
let currentOpenedFile = null;
let autosaveTimeout = null;
let isInitialLoading = false;
let isNewFile = true;
let draggedItemPath = null;
let openFolders = new Set(); // Множество для сохранения состояния раскрытых папок

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    refreshFileTree();
    setupTreeContainerDragEvents();
});

// Отслеживание ввода текста пользователем для автосохранения
quill.on('text-change', function(delta, oldDelta, source) {
    if (source === 'user' && !isInitialLoading && !isNewFile) {
        triggerAutosave();
    }
});

// Запуск таймера автосохранения (дебаунс 1 секунда)
function triggerAutosave() {
    if (isNewFile) return;

    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) return;

    updateSaveStatus('saving', 'Сохранение...');

    clearTimeout(autosaveTimeout);
    autosaveTimeout = setTimeout(() => {
        autoSaveCurrentFile();
    }, 1000);
}

// Автосохранение существующих файлов на сервер
async function autoSaveCurrentFile() {
    if (isNewFile) return;

    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) return;

    const htmlContent = quill.getSemanticHTML();

    try {
        const response = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: filename,
                content: htmlContent
            })
        });

        if (response.ok) {
            const data = await response.json();
            updateSaveStatus('saved', 'Все изменения сохранены');

            if (currentOpenedFile !== data.display_name) {
                currentOpenedFile = data.display_name;
                refreshFileTree();
            }
        } else {
            updateSaveStatus('error', 'Ошибка сохранения');
        }
    } catch (e) {
        updateSaveStatus('error', 'Ошибка сети');
    }
}

// Первоначальное сохранение нового документа (по кнопке "Сохранить")
async function manualSaveFile() {
    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) {
        alert('Укажите путь или название файла перед сохранением');
        return;
    }

    const htmlContent = quill.getSemanticHTML();

    try {
        const response = await fetch('/api/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                filename: filename,
                content: htmlContent
            })
        });

        if (response.ok) {
            const data = await response.json();
            
            // Переключаем в режим автосохранения
            isNewFile = false;
            currentOpenedFile = data.display_name;

            setEditorMode(false);
            updateSaveStatus('saved', 'Все изменения сохранены');

            await refreshFileTree();
        } else {
            alert('Ошибка при сохранении файла');
        }
    } catch (e) {
        alert('Ошибка сети при сохранении файла');
    }
}

// Загрузка файла в редактор
async function loadFile(relPath) {
    isInitialLoading = true;
    const response = await fetch(`/api/load/${encodeURIComponent(relPath)}`);
    if (response.ok) {
        const data = await response.json();
        document.getElementById('doc-title').value = data.display_name;
        
        quill.clipboard.dangerouslyPasteHTML(data.content);
        currentOpenedFile = data.display_name;
        isNewFile = false;

        setEditorMode(false);
        updateActiveHighlight(data.display_name);
        updateSaveStatus('saved', 'Сохранено');
    } else {
        alert('Ошибка при чтении файла');
    }
    setTimeout(() => { isInitialLoading = false; }, 300);
}

// Создание нового документа
function createNewFile(folderPrefix = '') {
    isInitialLoading = true;
    const titleInput = document.getElementById('doc-title');
    titleInput.value = folderPrefix ? `${folderPrefix}/` : '';
    quill.setText('');
    currentOpenedFile = null;
    isNewFile = true;

    if (folderPrefix) {
        openFolders.add(folderPrefix);
    }

    setEditorMode(true);
    document.querySelectorAll('.file-item, .folder-header').forEach(el => el.classList.remove('active'));
    titleInput.focus();
    setTimeout(() => { isInitialLoading = false; }, 300);
}

// --- Управление Модальным Окном Папок ---
function openFolderModal() {
    const modal = document.getElementById('folder-modal');
    const input = document.getElementById('modal-folder-name');
    input.value = '';
    modal.classList.add('active');
    setTimeout(() => input.focus(), 100);
}

function closeFolderModal() {
    document.getElementById('folder-modal').classList.remove('active');
}

function closeFolderModalOnBackdrop(event) {
    if (event.target.id === 'folder-modal') {
        closeFolderModal();
    }
}

function handleModalKeyDown(event) {
    if (event.key === 'Enter') {
        submitNewFolder();
    } else if (event.key === 'Escape') {
        closeFolderModal();
    }
}

async function submitNewFolder() {
    const input = document.getElementById('modal-folder-name');
    const folderName = input.value.trim();
    if (!folderName) {
        alert('Введите название папки');
        return;
    }

    const response = await fetch('/api/mkdir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_path: folderName })
    });

    if (response.ok) {
        closeFolderModal();
        refreshFileTree();
    } else {
        const data = await response.json();
        alert(data.error || 'Ошибка при создании папки');
    }
}

// Переключение между кнопкой "Сохранить" и плашкой автосохранения
function setEditorMode(newFileState) {
    const saveBtn = document.getElementById('save-btn');
    const saveStatus = document.getElementById('save-status');

    if (newFileState) {
        saveBtn.style.display = 'inline-flex';
        saveStatus.style.display = 'none';
    } else {
        saveBtn.style.display = 'none';
        saveStatus.style.display = 'inline-flex';
    }
}

// Удаление файла
async function deleteCurrentFile() {
    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) {
        alert('Выберите файл для удаления');
        return;
    }

    if (!confirm(`Вы действительно хотите удалить "${filename}"?`)) {
        return;
    }

    const response = await fetch(`/api/delete/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
    });

    if (response.ok) {
        createNewFile();
        refreshFileTree();
    } else {
        const data = await response.json();
        alert(data.error || 'Ошибка при удалении');
    }
}

// Экспорт в DOCX
function exportDocx() {
    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) {
        alert('Выберите файл перед экспортом');
        return;
    }
    window.location.href = `/api/export/docx/${encodeURIComponent(filename)}`;
}

// Обновление индикатора автосохранения
function updateSaveStatus(state, message) {
    const statusEl = document.getElementById('save-status');
    if (!statusEl) return;

    statusEl.className = `save-status ${state}`;
    statusEl.textContent = message;
}

// Очистка всех подсветок перетаскивания
function clearAllDragHighlights() {
    document.querySelectorAll('.drag-over, .drag-over-root').forEach(el => {
        el.classList.remove('drag-over', 'drag-over-root');
    });
}

// --- Отрисовка Дерева и Общая Обработка Drag-and-Drop ---
async function refreshFileTree() {
    const response = await fetch('/api/tree');
    if (response.ok) {
        const tree = await response.json();
        const treeContainer = document.getElementById('file-tree');
        treeContainer.innerHTML = '';

        if (!tree || tree.length === 0) {
            treeContainer.innerHTML = '<div class="empty-tree">Папка storage пуста</div>';
            return;
        }

        treeContainer.appendChild(renderTreeNodes(tree));
    }
}

// Единый делегированный обработчик перетаскивания для всего дерева сайдбара
function setupTreeContainerDragEvents() {
    const treeContainer = document.getElementById('file-tree');
    if (!treeContainer) return;

    treeContainer.addEventListener('dragover', (e) => {
        e.preventDefault();
        clearAllDragHighlights();

        const folderEl = e.target.closest('[data-folder-path]');
        if (folderEl) {
            const folderHeader = folderEl.querySelector('.folder-header');
            if (folderHeader) {
                folderHeader.classList.add('drag-over');
            }
        } else {
            treeContainer.classList.add('drag-over-root');
        }
    });

    treeContainer.addEventListener('dragleave', (e) => {
        if (!treeContainer.contains(e.relatedTarget)) {
            clearAllDragHighlights();
        }
    });

    treeContainer.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const folderEl = e.target.closest('[data-folder-path]');
        clearAllDragHighlights();

        if (draggedItemPath) {
            const destFolder = folderEl ? folderEl.getAttribute('data-folder-path') : '';
            moveItemToFolder(draggedItemPath, destFolder);
        }
    });
}

function renderTreeNodes(nodes) {
    const ul = document.createElement('ul');
    ul.className = 'tree-list';

    nodes.forEach(node => {
        if (node.type === 'folder') {
            const folderLi = document.createElement('li');
            folderLi.className = 'folder-node';
            folderLi.setAttribute('data-folder-path', node.rel_path);

            const isOpen = openFolders.has(node.rel_path);

            const folderDiv = document.createElement('div');
            folderDiv.className = `folder-header ${isOpen ? '' : 'collapsed'}`;
            folderDiv.innerHTML = `
                <span class="folder-toggle">▼</span>
                <span class="folder-icon">📁</span>
                <span class="folder-name">${node.name}</span>
                <button class="add-file-icon" title="Создать файл в этой папке" onclick="event.stopPropagation(); createNewFile('${node.rel_path}')">+</button>
            `;

            const childrenContainer = document.createElement('div');
            childrenContainer.className = `folder-children ${isOpen ? '' : 'hidden'}`;
            if (node.children && node.children.length > 0) {
                childrenContainer.appendChild(renderTreeNodes(node.children));
            } else {
                childrenContainer.innerHTML = '<div class="empty-subfolder">Пустая папка</div>';
            }

            folderDiv.onclick = () => {
                const isCollapsed = folderDiv.classList.toggle('collapsed');
                childrenContainer.classList.toggle('hidden');
                
                if (!isCollapsed) {
                    openFolders.add(node.rel_path);
                } else {
                    openFolders.delete(node.rel_path);
                }
            };

            folderLi.appendChild(folderDiv);
            folderLi.appendChild(childrenContainer);
            ul.appendChild(folderLi);
        } else {
            const li = document.createElement('li');
            const isActive = node.display_name === currentOpenedFile;
            li.className = `file-item ${isActive ? 'active' : ''}`;
            li.setAttribute('data-display', node.display_name);
            li.setAttribute('draggable', 'true');
            li.onclick = () => loadFile(node.rel_path);

            li.addEventListener('dragstart', (e) => {
                e.stopPropagation();
                draggedItemPath = node.rel_path;
                li.classList.add('dragging');
                e.dataTransfer.setData('text/plain', node.rel_path);
            });

            li.addEventListener('dragend', () => {
                li.classList.remove('dragging');
                draggedItemPath = null;
                clearAllDragHighlights();
            });

            const fileNameOnly = typeof node.display_name === 'string' 
                ? node.display_name.split('/').pop() 
                : node.name;

            li.innerHTML = `
                <div class="file-item-header">
                    <div class="file-title-group">
                        <span class="file-icon">📄</span>
                        <span class="file-name">${fileNameOnly}</span>
                    </div>
                    ${isActive ? '<span class="active-badge">ОТКРЫТ</span>' : ''}
                </div>
            `;

            ul.appendChild(li);
        }
    });

    return ul;
}

// Запрос на перемещение файла
async function moveItemToFolder(srcPath, destFolder) {
    if (!srcPath) return;

    const response = await fetch('/api/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            src_path: srcPath,
            dest_folder: destFolder
        })
    });

    if (response.ok) {
        const data = await response.json();
        
        // Раскрываем только целевую папку и ее родителей
        if (destFolder) {
            let currentPath = '';
            destFolder.split('/').forEach((part, index) => {
                currentPath = index === 0 ? part : `${currentPath}/${part}`;
                openFolders.add(currentPath);
            });
        }

        // Если открытый файл перенесли — обновляем путь в инпуте
        if (currentOpenedFile && (currentOpenedFile === srcPath || srcPath.includes(currentOpenedFile))) {
            currentOpenedFile = data.display_name;
            document.getElementById('doc-title').value = data.display_name;
            updateSaveStatus('saved', 'Сохранено');
        }
        await refreshFileTree();
    } else {
        const data = await response.json();
        alert(data.error || 'Ошибка при перемещении файла');
    }
}

// Выделение активного файла в дереве
function updateActiveHighlight(displayName) {
    document.querySelectorAll('.file-item').forEach(el => {
        const itemDisplay = el.getAttribute('data-display');
        if (itemDisplay === displayName) {
            el.classList.add('active');
            if (!el.querySelector('.active-badge')) {
                const header = el.querySelector('.file-item-header');
                if (header) {
                    const badge = document.createElement('span');
                    badge.className = 'active-badge';
                    badge.textContent = 'ОТКРЫТ';
                    header.appendChild(badge);
                }
            }
        } else {
            el.classList.remove('active');
            const badge = el.querySelector('.active-badge');
            if (badge) badge.remove();
        }
    });
}

// Поиск по названиям и содержимому
let searchTimeout = null;

function handleSearch() {
    clearTimeout(searchTimeout);

    searchTimeout = setTimeout(async () => {
        const query = document.getElementById('search-input').value.trim();
        const treeContainer = document.getElementById('file-tree');

        if (!query) {
            refreshFileTree();
            return;
        }

        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (response.ok) {
            const results = await response.json();
            treeContainer.innerHTML = '';

            if (results.length === 0) {
                treeContainer.innerHTML = '<div class="empty-tree">Ничего не найдено</div>';
                return;
            }

            const ul = document.createElement('ul');
            ul.className = 'tree-list';

            results.forEach(item => {
                const li = document.createElement('li');
                const isActive = item.display_name === currentOpenedFile;
                li.className = `file-item ${isActive ? 'active' : ''}`;
                li.setAttribute('data-display', item.display_name);
                li.onclick = () => loadFile(item.rel_path);

                li.innerHTML = `
                    <div class="file-item-header">
                        <div class="file-title-group">
                            <span class="file-icon">📄</span>
                            <span class="file-name">${item.display_name}</span>
                        </div>
                        ${isActive ? '<span class="active-badge">ОТКРЫТ</span>' : ''}
                    </div>
                    ${item.snippet ? `<div class="file-snippet">\${item.snippet}</div>` : ''}
                `;
                ul.appendChild(li);
            });

            treeContainer.appendChild(ul);
        }
    }, 300);
}
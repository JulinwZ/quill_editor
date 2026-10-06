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

let currentOpenedFile = null;
let autosaveTimeout = null;
let isInitialLoading = false;
let isNewFile = true; // По умолчанию считаем открытый редактор новым несохраненным файлом

// Отслеживание изменений в редакторе
quill.on('text-change', function(delta, oldDelta, source) {
    if (source === 'user' && !isInitialLoading && !isNewFile) {
        triggerAutosave();
    }
});

// Запуск дебаунса автосохранения
function triggerAutosave() {
    if (isNewFile) return; // Для новых файлов автосохранение не срабатывает

    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) return;

    updateSaveStatus('saving', 'Сохранение...');

    clearTimeout(autosaveTimeout);
    autosaveTimeout = setTimeout(() => {
        autoSaveCurrentFile();
    }, 1000);
}

// Автосохранение для существующих файлов
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
                refreshFileList();
            }
        } else {
            updateSaveStatus('error', 'Ошибка сохранения');
        }
    } catch (e) {
        updateSaveStatus('error', 'Ошибка сети');
    }
}

// Первоначальное сохранение вручную (по кнопке "Сохранить")
async function manualSaveFile() {
    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) {
        alert('Укажите название файла перед сохранением');
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
            
            // Переводим документ в режим автосохранения
            isNewFile = false;
            currentOpenedFile = data.display_name;

            // Переключаем кнопки и индикатор
            setEditorMode(false);
            updateSaveStatus('saved', 'Все изменения сохранены');

            // Обновляем список файлов в боковом меню
            await refreshFileList();
        } else {
            alert('Ошибка при сохранении файла');
        }
    } catch (e) {
        alert('Ошибка сети при сохранении файла');
    }
}

// Загрузка существующего файла из списка
async function loadFile(filename) {
    isInitialLoading = true;
    const response = await fetch(`/api/load/${encodeURIComponent(filename)}`);
    if (response.ok) {
        const data = await response.json();
        document.getElementById('doc-title').value = data.display_name;
        
        quill.clipboard.dangerouslyPasteHTML(data.content);
        currentOpenedFile = data.display_name;
        isNewFile = false;

        setEditorMode(false); // Существующий файл — скрываем кнопку "Сохранить", включаем статус
        updateActiveFileHighlight(data.display_name);
        updateSaveStatus('saved', 'Сохранено');
    } else {
        alert('Ошибка при чтении файла');
    }
    setTimeout(() => { isInitialLoading = false; }, 300);
}

// Создание нового файла (+ Новый документ)
function createNewFile() {
    isInitialLoading = true;
    document.getElementById('doc-title').value = '';
    quill.setText('');
    currentOpenedFile = null;
    isNewFile = true;

    setEditorMode(true); // Новый файл — показываем кнопку "Сохранить", скрываем статус
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
    setTimeout(() => { isInitialLoading = false; }, 300);
}

// Переключение видимости кнопки "Сохранить" и индикатора автосохранения
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

async function deleteCurrentFile() {
    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) {
        alert('Выберите файл для удаления');
        return;
    }

    if (!confirm(`Вы действительно хотите удалить файл "${filename}"?`)) {
        return;
    }

    const response = await fetch(`/api/delete/${encodeURIComponent(filename)}`, {
        method: 'DELETE'
    });

    if (response.ok) {
        createNewFile();
        refreshFileList();
    } else {
        const data = await response.json();
        alert(data.error || 'Ошибка при удалении файла');
    }
}

function exportDocx() {
    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) {
        alert('Выберите файл перед экспортом');
        return;
    }
    window.location.href = `/api/export/docx/${encodeURIComponent(filename)}`;
}

function updateSaveStatus(state, message) {
    const statusEl = document.getElementById('save-status');
    if (!statusEl) return;

    statusEl.className = `save-status ${state}`;
    statusEl.textContent = message;
}

async function refreshFileList() {
    const response = await fetch('/api/files');
    if (response.ok) {
        const files = await response.json();
        const fileListContainer = document.getElementById('file-list');
        fileListContainer.innerHTML = '';

        files.forEach(file => {
            const li = document.createElement('li');
            const isActive = file.display_name === currentOpenedFile;
            li.className = `file-item ${isActive ? 'active' : ''}`;
            li.onclick = () => loadFile(file.display_name);

            li.innerHTML = `
                <div class="file-item-header">
                    <div class="file-title-group">
                        <span class="file-icon">📄</span>
                        <span class="file-name">${file.display_name}</span>
                    </div>
                    ${isActive ? '<span class="active-badge">ОТКРЫТ</span>' : ''}
                </div>
            `;
            fileListContainer.appendChild(li);
        });
    }
}

function updateActiveFileHighlight(displayName) {
    document.querySelectorAll('.file-item').forEach(el => {
        const nameText = el.querySelector('.file-name')?.textContent.trim();
        if (nameText === displayName) {
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

let searchTimeout = null;

function handleSearch() {
    clearTimeout(searchTimeout);

    searchTimeout = setTimeout(async () => {
        const query = document.getElementById('search-input').value.trim();
        const fileListContainer = document.getElementById('file-list');

        if (!query) {
            refreshFileList();
            return;
        }

        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (response.ok) {
            const results = await response.json();
            fileListContainer.innerHTML = '';

            if (results.length === 0) {
                fileListContainer.innerHTML = '<li class="file-item"><span class="file-snippet">Ничего не найдено</span></li>';
                return;
            }

            results.forEach(item => {
                const li = document.createElement('li');
                const isActive = item.display_name === currentOpenedFile;
                li.className = `file-item ${isActive ? 'active' : ''}`;
                li.onclick = () => loadFile(item.display_name);

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
                fileListContainer.appendChild(li);
            });
        }
    }, 300);
}
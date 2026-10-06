const quill = new Quill('#editor', {
    theme: 'snow',
    placeholder: 'Нажмите сюда для ввода текста документа...',
    modules: {
        toolbar: [
            [{ 'header': [1, 2, 3, false] }],
            ['bold', 'italic', 'underline', 'strike'],
            // Добавляем { 'list': 'check' } рядом с обычными списками
            [{ 'list': 'ordered'}, { 'list': 'bullet'}, { 'list': 'check' }],
            [{ 'color': [] }, { 'background': [] }],
            ['clean']
        ]
    }
});

let currentOpenedFile = null;

async function loadFile(filename) {
    const response = await fetch(`/api/load/${encodeURIComponent(filename)}`);
    if (response.ok) {
        const data = await response.json();
        document.getElementById('doc-title').value = data.filename;
        
        quill.clipboard.dangerouslyPasteHTML(data.content);
        currentOpenedFile = data.filename;

        updateActiveFileHighlight(filename);
    } else {
        alert('Ошибка при чтении файла');
    }
}

async function saveCurrentFile() {
    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) {
        alert('Укажите название файла');
        return;
    }

    const htmlContent = quill.getSemanticHTML();

    const response = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            filename: filename,
            content: htmlContent
        })
    });

    if (response.ok) {
        alert('Файл успешно сохранен!');
        location.reload();
    } else {
        alert('Ошибка при сохранении');
    }
}

// Удаление выбранного файла
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
        alert('Файл успешно удален!');
        createNewFile();
        location.reload();
    } else {
        const data = await response.json();
        alert(data.error || 'Ошибка при удалении файла');
    }
}

function createNewFile() {
    document.getElementById('doc-title').value = '';
    quill.setText('');
    currentOpenedFile = null;
    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
}

function updateActiveFileHighlight(filename) {
    document.querySelectorAll('.file-item').forEach(el => {
        const nameText = el.querySelector('.file-name')?.textContent.trim();
        if (nameText === filename) {
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

// Поиск по файлам
let searchTimeout = null;

function handleSearch() {
    clearTimeout(searchTimeout);

    searchTimeout = setTimeout(async () => {
        const query = document.getElementById('search-input').value.trim();
        const fileListContainer = document.getElementById('file-list');

        if (!query) {
            location.reload();
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
                const isActive = item.filename === currentOpenedFile;
                li.className = `file-item ${isActive ? 'active' : ''}`;
                li.onclick = () => loadFile(item.filename);

                li.innerHTML = `
                    <div class="file-item-header">
                        <div class="file-title-group">
                            <span class="file-icon">📄</span>
                            <span class="file-name">${item.filename}</span>
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
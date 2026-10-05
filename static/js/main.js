// Инициализируем Quill.js
const quill = new Quill('#editor', {
    theme: 'snow'
});

// Загрузка содержимого файла в редактор
async function loadFile(filename) {
    const response = await fetch(`/api/load/${filename}`);
    if (response.ok) {
        const data = await response.json();
        document.getElementById('doc-title').value = data.filename;
        
        // Вставляем полученный HTML напрямую в редактор
        quill.clipboard.dangerouslyPasteHTML(data.content);
    } else {
        alert('Ошибка при чтении файла');
    }
}

// Отправка отредактированного текста на Flask
async function saveCurrentFile() {
    const filename = document.getElementById('doc-title').value.trim();
    if (!filename) {
        alert('Укажите название файла');
        return;
    }

    // Извлекаем чистый HTML-код из Quill.js
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

function createNewFile() {
    document.getElementById('doc-title').value = '';
    quill.setText('');
}
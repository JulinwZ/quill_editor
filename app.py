import os
import re
import io
from flask import Flask, render_template, request, jsonify, send_file
from docx import Document
from htmldocx import HtmlToDocx

app = Flask(__name__)

STORAGE_DIR = os.path.join(app.root_path, 'storage')
os.makedirs(STORAGE_DIR, exist_ok=True)


# Вспомогательная функция для поиска файла с расширением или без
def resolve_filepath(filename):
    file_path = os.path.join(STORAGE_DIR, filename)
    if os.path.exists(file_path):
        return file_path, filename

    if not (filename.endswith('.txt') or filename.endswith('.html')):
        for ext in ['.txt', '.html']:
            path = os.path.join(STORAGE_DIR, filename + ext)
            if os.path.exists(path):
                return path, filename + ext

    return file_path, filename


@app.route("/")
def index():
    files = []
    for f in os.listdir(STORAGE_DIR):
        if f.endswith(('.txt', '.html')):
            display_name = os.path.splitext(f)[0]
            files.append({'full_name': f, 'display_name': display_name})
    return render_template("index.html", files=files)


@app.route("/api/files", methods=['GET'])
def get_files():
    files = []
    for f in os.listdir(STORAGE_DIR):
        if f.endswith(('.txt', '.html')):
            display_name = os.path.splitext(f)[0]
            files.append({'full_name': f, 'display_name': display_name})
    return jsonify(files)


@app.route("/api/load/<filename>", methods=['GET'])
def load_file(filename):
    file_path, actual_filename = resolve_filepath(filename)
    if not os.path.exists(file_path):
        return jsonify({'error': 'Не удалось найти файл'}), 404

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    display_name = os.path.splitext(actual_filename)[0]
    return jsonify({
        'filename': actual_filename,
        'display_name': display_name,
        'content': content
    })


@app.route('/api/save', methods=['POST'])
def save_file():
    data = request.get_json()
    filename = data.get('filename', '').strip()
    content = data.get('content', '')

    if not filename:
        return jsonify({'error': 'Не указано имя файла'}), 400

    # Автоматически добавляем .txt, если пользователь не указал расширение
    if not (filename.endswith('.txt') or filename.endswith('.html')):
        filename += '.txt'

    file_path = os.path.join(STORAGE_DIR, filename)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)

    display_name = os.path.splitext(filename)[0]
    return jsonify({
        'message': 'Файл сохранен',
        'filename': filename,
        'display_name': display_name
    })


@app.route('/api/delete/<filename>', methods=['DELETE'])
def delete_file(filename):
    file_path, actual_filename = resolve_filepath(filename)
    if not os.path.exists(file_path):
        return jsonify({'error': 'Файл не найден'}), 404

    try:
        os.remove(file_path)
        return jsonify({'message': 'Файл успешно удален', 'filename': actual_filename})
    except Exception as e:
        return jsonify({'error': f'Ошибка при удалении файла: {str(e)}'}), 500


@app.route('/api/export/docx/<filename>', methods=['GET'])
def export_docx(filename):
    file_path, actual_filename = resolve_filepath(filename)
    if not os.path.exists(file_path):
        return jsonify({'error': 'Файл не найден'}), 404

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            html_content = f.read()

        doc = Document()
        new_parser = HtmlToDocx()
        new_parser.add_html_to_document(html_content, doc)

        file_stream = io.BytesIO()
        doc.save(file_stream)
        file_stream.seek(0)

        base_name = os.path.splitext(actual_filename)[0]

        return send_file(
            file_stream,
            as_attachment=True,
            download_name=f"{base_name}.docx",
            mimetype='application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        )
    except Exception as e:
        return jsonify({'error': f'Ошибка при конвертации в DOCX: {str(e)}'}), 500


@app.route('/api/search', methods=['GET'])
def search_files():
    query = request.args.get('q', '').strip().lower()
    if not query:
        return jsonify([])

    results = []
    files = [f for f in os.listdir(STORAGE_DIR) if f.endswith(('.txt', '.html'))]

    for filename in files:
        file_path = os.path.join(STORAGE_DIR, filename)
        display_name = os.path.splitext(filename)[0]

        title_match = query in display_name.lower() or query in filename.lower()
        content_match = False
        snippet = ""

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                raw_content = f.read()

            clean_text = re.sub(r'<[^>]+>', ' ', raw_content)
            clean_text_lower = clean_text.lower()

            if query in clean_text_lower:
                content_match = True
                idx = clean_text_lower.find(query)
                start = max(0, idx - 30)
                end = min(len(clean_text), idx + len(query) + 40)
                snippet = "..." + clean_text[start:end].replace('\n', ' ') + "..."

        except Exception:
            continue

        if title_match or content_match:
            results.append({
                'filename': filename,
                'display_name': display_name,
                'snippet': snippet if content_match else 'Совпадение в названии файла'
            })

    return jsonify(results)


if __name__ == '__main__':
    app.run(debug=True)
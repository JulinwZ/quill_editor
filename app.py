import os
import re
import io
import shutil
from flask import Flask, render_template, request, jsonify, send_file
from docx import Document
from htmldocx import HtmlToDocx

app = Flask(__name__)

STORAGE_DIR = os.path.join(app.root_path, 'storage')
os.makedirs(STORAGE_DIR, exist_ok=True)


def get_safe_path(filepath):
    safe_rel = os.path.normpath(filepath).lstrip('/\\')
    full_path = os.path.abspath(os.path.join(STORAGE_DIR, safe_rel))
    if not full_path.startswith(os.path.abspath(STORAGE_DIR)):
        return None, None
    return full_path, safe_rel


def resolve_filepath(filepath):
    full_path, safe_rel = get_safe_path(filepath)
    if full_path and os.path.exists(full_path):
        return full_path, safe_rel

    if full_path and not (filepath.endswith('.txt') or filepath.endswith('.html')):
        for ext in ['.txt', '.html']:
            alt_full, alt_rel = get_safe_path(filepath + ext)
            if alt_full and os.path.exists(alt_full):
                return alt_full, alt_rel

    return full_path, safe_rel


# Построение дерева: Сначала папки, затем файлы
def build_file_tree(dir_path):
    folders = []
    files = []
    try:
        entries = sorted(os.listdir(dir_path))
    except Exception:
        return []

    for entry in entries:
        full_item_path = os.path.join(dir_path, entry)
        rel_path = os.path.relpath(full_item_path, STORAGE_DIR).replace('\\', '/')

        if os.path.isdir(full_item_path):
            children = build_file_tree(full_item_path)
            folders.append({
                'type': 'folder',
                'name': entry,
                'rel_path': rel_path,
                'children': children
            })
        elif entry.endswith(('.txt', '.html')):
            display_name = os.path.splitext(rel_path)[0]
            files.append({
                'type': 'file',
                'name': entry,
                'rel_path': rel_path,
                'display_name': display_name
            })

    return folders + files


@app.route("/")
def index():
    tree = build_file_tree(STORAGE_DIR)
    return render_template("index.html", tree=tree)


@app.route("/api/tree", methods=['GET'])
def get_tree():
    tree = build_file_tree(STORAGE_DIR)
    return jsonify(tree)


@app.route("/api/mkdir", methods=['POST'])
def make_directory():
    data = request.get_json()
    folder_path = data.get('folder_path', '').strip()

    if not folder_path:
        return jsonify({'error': 'Укажите название папки'}), 400

    full_path, rel_path = get_safe_path(folder_path)
    if not full_path:
        return jsonify({'error': 'Недопустимый путь'}), 403

    os.makedirs(full_path, exist_ok=True)
    return jsonify({'message': 'Папка создана', 'rel_path': rel_path})


@app.route("/api/move", methods=['POST'])
def move_item():
    data = request.get_json()
    src_path = data.get('src_path', '').strip()
    dest_folder = data.get('dest_folder', '').strip()

    if not src_path:
        return jsonify({'error': 'Не указан исходный путь'}), 400

    src_full, src_rel = resolve_filepath(src_path)
    if not src_full or not os.path.exists(src_full):
        return jsonify({'error': 'Исходный файл не найден'}), 404

    filename = os.path.basename(src_full)
    dest_path = os.path.join(dest_folder, filename) if dest_folder else filename
    dest_full, dest_rel = get_safe_path(dest_path)

    if not dest_full:
        return jsonify({'error': 'Недопустимый целевой путь'}), 403

    if src_full == dest_full:
        clean_dest = os.path.splitext(dest_rel)[0]
        return jsonify({'message': 'Файл уже находится в этой папке', 'new_path': dest_rel, 'display_name': clean_dest})

    try:
        os.makedirs(os.path.dirname(dest_full), exist_ok=True)
        shutil.move(src_full, dest_full)
        clean_dest = os.path.splitext(dest_rel)[0]
        return jsonify({'message': 'Перемещение выполнено', 'new_path': dest_rel, 'display_name': clean_dest})
    except Exception as e:
        return jsonify({'error': f'Ошибка при перемещении: {str(e)}'}), 500


@app.route("/api/load/<path:filepath>", methods=['GET'])
def load_file(filepath):
    full_path, rel_path = resolve_filepath(filepath)

    if not full_path or not os.path.exists(full_path) or os.path.isdir(full_path):
        return jsonify({'error': 'Не удалось найти файл'}), 404

    with open(full_path, 'r', encoding='utf-8') as f:
        content = f.read()

    clean_display = os.path.splitext(rel_path)[0]

    return jsonify({
        'rel_path': rel_path,
        'display_name': clean_display,
        'content': content
    })


@app.route('/api/save', methods=['POST'])
def save_file():
    data = request.get_json()
    filepath = data.get('filename', '').strip()
    content = data.get('content', '')

    if not filepath:
        return jsonify({'error': 'Не указано имя файла'}), 400

    if not (filepath.endswith('.txt') or filepath.endswith('.html')):
        filepath += '.txt'

    full_path, rel_path = get_safe_path(filepath)
    if not full_path:
        return jsonify({'error': 'Недопустимый путь'}), 403

    os.makedirs(os.path.dirname(full_path), exist_ok=True)

    with open(full_path, 'w', encoding='utf-8') as f:
        f.write(content)

    clean_display = os.path.splitext(rel_path)[0]

    return jsonify({
        'message': 'Файл сохранен',
        'rel_path': rel_path,
        'display_name': clean_display
    })


@app.route('/api/delete/<path:filepath>', methods=['DELETE'])
def delete_item(filepath):
    full_path, rel_path = resolve_filepath(filepath)
    if not full_path or not os.path.exists(full_path):
        return jsonify({'error': 'Объект не найден'}), 404

    try:
        if os.path.isdir(full_path):
            shutil.rmtree(full_path)
        else:
            os.remove(full_path)
        return jsonify({'message': 'Успешно удалено', 'rel_path': rel_path})
    except Exception as e:
        return jsonify({'error': f'Ошибка при удалении: {str(e)}'}), 500


@app.route('/api/export/docx/<path:filepath>', methods=['GET'])
def export_docx(filepath):
    full_path, rel_path = resolve_filepath(filepath)

    if not full_path or not os.path.exists(full_path):
        return jsonify({'error': 'Файл не найден'}), 404

    try:
        with open(full_path, 'r', encoding='utf-8') as f:
            html_content = f.read()

        doc = Document()
        new_parser = HtmlToDocx()
        new_parser.add_html_to_document(html_content, doc)

        file_stream = io.BytesIO()
        doc.save(file_stream)
        file_stream.seek(0)

        filename_only = os.path.basename(rel_path)
        base_name = os.path.splitext(filename_only)[0]

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

    for root, dirs, files in os.walk(STORAGE_DIR):
        for filename in files:
            if filename.endswith(('.txt', '.html')):
                full_path = os.path.join(root, filename)
                rel_path = os.path.relpath(full_path, STORAGE_DIR).replace('\\', '/')
                clean_display = os.path.splitext(rel_path)[0]

                title_match = query in clean_display.lower() or query in filename.lower()
                content_match = False
                snippet = ""

                try:
                    with open(full_path, 'r', encoding='utf-8') as f:
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
                        'rel_path': rel_path,
                        'display_name': clean_display,
                        'snippet': snippet if content_match else 'Совпадение в названии пути'
                    })

    return jsonify(results)


if __name__ == '__main__':
    app.run(debug=True)
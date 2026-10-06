import os
import re
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

STORAGE_DIR = os.path.join(app.root_path, 'storage')
os.makedirs(STORAGE_DIR, exist_ok=True)


@app.route("/")
def index():
    files = [f for f in os.listdir(STORAGE_DIR) if f.endswith(('.txt', '.html'))]
    return render_template("index.html", files=files)


@app.route("/api/load/<filename>", methods=['GET'])
def load_file(filename):
    file_path = os.path.join(STORAGE_DIR, filename)
    if not os.path.exists(file_path):
        return jsonify({'error': 'Не удалось найти файл'}), 404

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    return jsonify({'filename': filename, 'content': content})


@app.route('/api/save', methods=['POST'])
def save_file():
    data = request.get_json()
    filename = data.get('filename')
    content = data.get('content', '')

    if not filename:
        return jsonify({'error': 'Не указано имя файла'}), 400

    file_path = os.path.join(STORAGE_DIR, filename)
    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(content)
    return jsonify({'message': 'Файл сохранен', 'filename': filename})


# --- НОВЫЙ ЭНДПОИНТ ДЛЯ УДАЛЕНИЯ ФАЙЛА ---
@app.route('/api/delete/<filename>', methods=['DELETE'])
def delete_file(filename):
    file_path = os.path.join(STORAGE_DIR, filename)
    if not os.path.exists(file_path):
        return jsonify({'error': 'Файл не найден'}), 404

    try:
        os.remove(file_path)
        return jsonify({'message': 'Файл успешно удален', 'filename': filename})
    except Exception as e:
        return jsonify({'error': f'Ошибка при удалении файла: {str(e)}'}), 500


@app.route('/api/search', methods=['GET'])
def search_files():
    query = request.args.get('q', '').strip().lower()
    if not query:
        return jsonify([])

    results = []
    files = [f for f in os.listdir(STORAGE_DIR) if f.endswith(('.txt', '.html'))]

    for filename in files:
        file_path = os.path.join(STORAGE_DIR, filename)

        title_match = query in filename.lower()
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
                'snippet': snippet if content_match else 'Совпадение в названии файла'
            })

    return jsonify(results)


if __name__ == '__main__':
    app.run(debug=True)
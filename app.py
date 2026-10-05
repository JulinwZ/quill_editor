import os
from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

STORAGE_DIR = os.path.join(app.root_path, 'storage')
os.makedirs(STORAGE_DIR, exist_ok=True)


@app.route("/")
def index():
    files = [f for f in os.listdir(STORAGE_DIR) if f.endswith(('.txt', '.html'))]
    return render_template("index.html", files=files);

@app.route("/api/load/<filename>", methods=['GET'])
def load_file(filename):
    file_path = os.path.join(STORAGE_DIR, filename)
    if not file_path:
        return jsonify({'error': 'Не удалось найти файл'}), 404

    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    return jsonify({'filename':filename, 'content':content})


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
    return jsonify({'message':'Файл сохранен', 'filename':filename})

if __name__ == '__main__':
    app.run(debug=True)
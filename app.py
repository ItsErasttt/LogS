from flask import Flask, render_template, request, jsonify
import joblib
import pandas as pd
from rdkit import Chem
from rdkit.Chem import Descriptors, AllChem, Draw
import base64
import io

app = Flask(__name__)

# Загрузка модели и scaler
model = joblib.load('models/logS_predictor_model.joblib')
scaler = joblib.load('models/scaler.joblib')

# Функция для вычисления молекулярных дескрипторов
def calculate_descriptors(smiles):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    descriptors = {
        'MolecularWeight': Descriptors.MolWt(mol),
        'LogP': Descriptors.MolLogP(mol),
        'NumHDonors': Descriptors.NumHDonors(mol),
        'NumHAcceptors': Descriptors.NumHAcceptors(mol),
        'TPSA': Descriptors.TPSA(mol),
        'NumRotatableBonds': Descriptors.NumRotatableBonds(mol),
        'NumAromaticRings': Descriptors.NumAromaticRings(mol),
    }
    return descriptors

# Функция для вычисления Morgan fingerprints
def calculate_fingerprints(smiles, radius=2, n_bits=1024):
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        return None
    fingerprint = AllChem.GetMorganFingerprintAsBitVect(mol, radius, nBits=n_bits)
    return list(fingerprint)

# Функция для предсказания logS и расчета растворимости
def predict_log_s(smiles_list):
    predictions = []
    for smiles in smiles_list:
        new_data = pd.DataFrame({'SMILES': [smiles]})
        new_data['Descriptors'] = new_data['SMILES'].apply(calculate_descriptors)
        new_data['Fingerprint'] = new_data['SMILES'].apply(calculate_fingerprints)

        if new_data['Descriptors'].isnull().any() or new_data['Fingerprint'].isnull().any():
            predictions.append({
                'smiles': smiles,
                'error': 'Некорректная SMILES-строка',
                'image': None,
                'logS': None,
                'solubility_mol': None,
                'solubility_mass': None,
                'solubility_ppm': None,
                'solubility_class': None
            })
            continue

        descriptors_df = pd.json_normalize(new_data['Descriptors'])
        fingerprint_df = pd.DataFrame(new_data['Fingerprint'].tolist(), index=new_data.index)
        fingerprint_df.columns = [f"FP_{i}" for i in range(fingerprint_df.shape[1])]
        descriptors_df.rename(columns={'MolecularWeight': 'MW', 'LogP': 'logP'}, inplace=True)

        new_data = pd.concat([new_data, descriptors_df, fingerprint_df], axis=1)
        new_data = new_data.drop(columns=['SMILES', 'Descriptors', 'Fingerprint'])

        expected_columns = [
            'logP', 'MW', 'NumHDonors', 'NumHAcceptors', 'TPSA',
            'NumRotatableBonds', 'NumAromaticRings'
        ] + [f"FP_{i}" for i in range(1024)]

        for col in expected_columns:
            if col not in new_data.columns:
                new_data[col] = 0

        new_data = new_data[expected_columns]
        new_data_scaled = pd.DataFrame(scaler.transform(new_data), columns=new_data.columns)
        prediction = model.predict(new_data_scaled)[0]

        # Вычисление растворимости
        mol = Chem.MolFromSmiles(smiles)
        mw = Descriptors.MolWt(mol) if mol else None
        solubility_mol = 10 ** prediction if prediction is not None else None
        solubility_mass = solubility_mol * mw if solubility_mol and mw else None
        solubility_ppm = solubility_mass * 1000 if solubility_mass else None

        # Класс растворимости
        if prediction > -1:
            solubility_class = "Очень высокая"
        elif -1 >= prediction > -2:
            solubility_class = "Высокая"
        elif -2 >= prediction > -4:
            solubility_class = "Умеренная"
        elif -4 >= prediction > -6:
            solubility_class = "Низкая"
        else:
            solubility_class = "Очень низкая"

        # Создание изображения молекулы
        img = Draw.MolToImage(mol) if mol else None
        buffered = io.BytesIO()
        if img:
            img.save(buffered, format="PNG")
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
        else:
            img_str = None

        predictions.append({
            'smiles': smiles,
            'image': f"data:image/png;base64,{img_str}" if img_str else None,
            'logS': float(prediction) if prediction is not None else None,
            'solubility_mol': float(solubility_mol) if solubility_mol is not None else None,
            'solubility_mass': float(solubility_mass) if solubility_mass is not None else None,
            'solubility_ppm': float(solubility_ppm) if solubility_ppm is not None else None,
            'solubility_class': solubility_class
        })

    return predictions

# Маршрут для главной страницы
@app.route('/')
def index():
    return render_template('index.html')

# Маршрут для обработки запроса
@app.route('/predict', methods=['POST'])
def predict():
    data = request.json
    smiles_list = data.get('smiles', [])
    predictions = predict_log_s(smiles_list)
    print(predictions)  # Отладочный вывод
    return jsonify(predictions)

if __name__ == '__main__':
    app.run(debug=True)
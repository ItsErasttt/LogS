document.addEventListener('DOMContentLoaded', () => {
    let resultsData = []; // Хранение данных для экспорта

    // Переключатель темы
    const themeToggle = document.getElementById('switch');
    if (themeToggle) {
        themeToggle.addEventListener('change', () => {
            document.body.classList.toggle('dark-theme');
            localStorage.setItem('theme', document.body.classList.contains('dark-theme') ? 'dark' : 'light');
        });

        // Загрузка сохраненной темы
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-theme');
            themeToggle.checked = true;
        }
    } else {
        console.error('Элемент switch не найден!');
    }

    // Обработчик кнопки "Предсказать Log S" (ручной ввод)
    document.getElementById('predict-button').addEventListener('click', async () => {
        const smilesInput = document.getElementById('smiles-input').value.trim();
        if (!smilesInput) {
            alert('Пожалуйста, введите хотя бы одну SMILES-строку.');
            return;
        }

        const smilesList = smilesInput.split('\n').map(smiles => smiles.trim()).filter(smiles => smiles);

        try {
            const response = await fetch('/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ smiles: smilesList }),
            });

            const results = await response.json();
            resultsData = results;

            displayResults(results);
            document.getElementById('export-buttons').style.display = 'block';
        } catch (error) {
            console.error('Ошибка:', error);
            alert('Произошла ошибка при обработке запроса.');
        }
    });

    // Обработчик кнопки "Поиск в PubChem"
    document.getElementById('pubchem-search-button').addEventListener('click', async () => {
        const query = document.getElementById('pubchem-input').value.trim();
        if (!query) {
            alert('Пожалуйста, введите название или CID молекулы.');
            return;
        }

        const spinner = document.getElementById('loading-spinner');
        spinner.style.display = 'flex'; // Показываем спиннер

        try {
            const isCID = /^\d+$/.test(query);
            const url = isCID
                ? `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${query}/property/CanonicalSMILES/JSON`
                : `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(query)}/property/CanonicalSMILES/JSON`;

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Молекула не найдена. Проверьте название или CID.');
            }

            const data = await response.json();
            const smiles = data.PropertyTable.Properties[0].CanonicalSMILES;

            const smilesInput = document.getElementById('smiles-input');
            smilesInput.value += (smilesInput.value ? '\n' : '') + smiles;
            alert(`SMILES успешно добавлен: ${smiles}`);
        } catch (error) {
            console.error('Ошибка при поиске в PubChem:', error);
            alert(error.message || 'Произошла ошибка при поиске молекулы.');
        } finally {
            spinner.style.display = 'none'; // Скрываем спиннер
        }
    });

    // Обработчик загрузки CSV
    document.getElementById('upload-button').addEventListener('click', async () => {
        const fileInput = document.getElementById('csv-input');
        const file = fileInput.files[0];
        if (!file) {
            alert('Пожалуйста, выберите CSV-файл.');
            return;
        }

        const progressBarContainer = document.getElementById('progress-bar-container');
        const progressText = document.getElementById('progress-text');
        const progressFill = document.getElementById('progress-fill');
        progressBarContainer.style.display = 'block';

        try {
            const reader = new FileReader();
            reader.onload = async (event) => {
                const csvContent = event.target.result;
                const smilesList = csvContent.split('\n').map(row => row.trim()).filter(row => row);

                const batchSize = 10; // Размер пакета для отправки
                const totalBatches = Math.ceil(smilesList.length / batchSize);
                let results = [];

                for (let i = 0; i < totalBatches; i++) {
                    const start = i * batchSize;
                    const end = start + batchSize;
                    const batch = smilesList.slice(start, end);

                    const response = await fetch('/predict', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ smiles: batch }),
                    });

                    const batchResults = await response.json();
                    results = results.concat(batchResults);

                    // Обновление строки прогресса
                    const progress = ((i + 1) / totalBatches) * 100;
                    progressText.textContent = `Обработано: ${Math.round(progress)}%`;
                    progressFill.style.width = `${progress}%`;
                }

                // Сохранение данных для экспорта
                resultsData = results;

                // Отображение результатов
                displayResults(results);
                document.getElementById('export-buttons').style.display = 'block';
            };

            reader.readAsText(file);
        } catch (error) {
            console.error('Ошибка:', error);
            alert('Произошла ошибка при загрузке файла.');
        }
    });

    // Экспорт в CSV
    document.getElementById('export-csv').addEventListener('click', () => {
        const csvRows = [
            ['SMILES', 'Predicted logS', 'Solubility (mol/L)', 'Solubility (g/L)', 'Solubility (ppm)', 'Solubility Class']
        ];

        resultsData.forEach(result => {
            const row = [
                result.smiles,
                result.logS ? result.logS.toFixed(4) : 'N/A',
                result.solubility_mol ? result.solubility_mol.toFixed(4) : 'N/A',
                result.solubility_mass ? result.solubility_mass.toFixed(4) : 'N/A',
                result.solubility_ppm ? result.solubility_ppm.toFixed(4) : 'N/A',
                result.solubility_class || 'N/A'
            ];
            csvRows.push(row);
        });

        const csvContent = csvRows.map(row => row.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.setAttribute('download', 'results.csv');
        link.click();
    });

    // Функция для отображения результатов
    function displayResults(results) {
        const resultsContainer = document.getElementById('results');
        resultsContainer.innerHTML = '';

        results.forEach(result => {
            const moleculeDiv = document.createElement('div');
            moleculeDiv.classList.add('molecule');

            if (result.error) {
                moleculeDiv.innerHTML = `<p><strong>SMILES:</strong> ${result.smiles}</p><p style="color: red;">${result.error}</p>`;
            } else {
                let predictionClass = '';
                if (result.logS > 0) {
                    predictionClass = 'prediction-high';
                } else if (result.logS > -2) {
                    predictionClass = 'prediction-medium';
                } else {
                    predictionClass = 'prediction-low';
                }

                moleculeDiv.innerHTML = `
                    <p><strong>SMILES:</strong> ${result.smiles}</p>
                    <img src="${result.image}" alt="Химическая структура">
                    <p><strong>Predicted logS:</strong> <span class="${predictionClass}">${result.logS ? result.logS.toFixed(4) : 'N/A'}</span></p>
                    <p><strong>Растворимость (моль/л):</strong> ${result.solubility_mol ? result.solubility_mol.toFixed(4) : 'N/A'}</p>
                    <p><strong>Растворимость (г/л):</strong> ${result.solubility_mass ? result.solubility_mass.toFixed(4) : 'N/A'}</p>
                    <p><strong>Растворимость (ppm):</strong> ${result.solubility_ppm ? result.solubility_ppm.toFixed(4) : 'N/A'}</p>
                    <p><strong>Класс растворимости:</strong> ${result.solubility_class || 'N/A'}</p>
                `;
            }

            resultsContainer.appendChild(moleculeDiv);
        });
    }
});
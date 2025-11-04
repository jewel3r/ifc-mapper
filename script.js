// script.js
class IfcModelMapper {
    constructor() {
        this.sourceEditor = null;
        this.targetEditor = null;
        this.currentMapping = null;
        this.isEditorsReady = false;
        this.ifcClasses = [
            'IfcProduct', 'IfcBuilding', 'IfcBuildingStorey', 'IfcSpace', 
            'IfcWall', 'IfcDoor', 'IfcWindow', 'IfcSlab', 'IfcRoof',
            'IfcBeam', 'IfcColumn', 'IfcFooting', 'IfcStair',
            'IfcRamp', 'IfcRailing', 'IfcSystem', 'IfcDistributionElement'
        ];
        this.ifcAttributes = [
            'Name', 'Description', 'ObjectType', 'OverallHeight', 'OverallWidth',
            'OverallLength', 'GrossArea', 'NetArea', 'GrossVolume', 'NetVolume',
            'Material', 'LoadBearing', 'IsExternal', 'FireRating', 'AcousticRating'
        ];
        this.init();
    }

    init() {
        this.initEditors();
        this.bindEvents();
        this.initTabs();
    }

    initEditors() {
        require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@0.33.0/min/vs' }});
        
        require(['vs/editor/editor.main'], () => {
            this.sourceEditor = monaco.editor.create(document.getElementById('sourceEditor'), {
                value: '// Вставьте вашу исходную модель здесь\n// Поддерживаемые форматы: OWL Turtle, OWL RDF/XML\n\n@prefix : <http://example.org/ontology#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n\n:Building a owl:Class .\n:Wall a owl:Class .\n:Door a owl:Class .\n\n:hasHeight a owl:DatatypeProperty .\n:hasMaterial a owl:ObjectProperty .',
                language: 'turtle',
                theme: 'vs-light',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true
            });

            this.targetEditor = monaco.editor.create(document.getElementById('targetEditor'), {
                value: '// IFC результат появится здесь после настройки соответствий',
                language: 'plaintext',
                theme: 'vs-light',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                readOnly: false,
                automaticLayout: true
            });

            this.isEditorsReady = true;
            this.showSuccess('Редакторы загружены и готовы к работе');
        });
    }

    initTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');
                this.switchTab(tabId);
            });
        });
    }

    switchTab(tabId) {
        // Обновляем активные кнопки вкладок
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

        // Обновляем активные панели вкладок
        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(tabId).classList.add('active');

        // Обновляем размеры редакторов
        setTimeout(() => {
            if (this.targetEditor) {
                this.targetEditor.layout();
            }
        }, 100);
    }

    bindEvents() {
        // Основные кнопки
        document.getElementById('convertBtn').addEventListener('click', () => this.convertToIfc());
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileUpload(e));
        document.getElementById('detectTypeBtn').addEventListener('click', () => this.autoDetectType());
        document.getElementById('validateSourceBtn').addEventListener('click', () => this.validateSource());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadIfc());
        document.getElementById('formatSourceBtn').addEventListener('click', () => this.formatSource());
        document.getElementById('exportMappingBtn').addEventListener('click', () => this.exportMapping());
        
        // Полноэкранный режим
        document.getElementById('fullscreenSourceBtn').addEventListener('click', () => this.toggleFullscreen('source'));
        document.getElementById('fullscreenTargetBtn').addEventListener('click', () => this.toggleFullscreen('target'));
        
        // Модальное окно
        document.getElementById('advancedSettingsBtn').addEventListener('click', () => this.showAdvancedSettings());
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveAdvancedSettings());
        document.getElementById('cancelSettingsBtn').addEventListener('click', () => this.hideAdvancedSettings());
    }

    // Методы для уведомлений (остаются без изменений)
    showSuccess(message) {
        this.showNotification(message, 'success');
    }

    showError(message) {
        this.showNotification(message, 'error');
    }

    showInfo(message) {
        this.showNotification(message, 'info');
    }

    showNotification(message, type = 'info') {
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 5px;
            color: white;
            font-weight: 500;
            z-index: 10000;
            max-width: 400px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease-out;
        `;

        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#3b82f6'
        };
        
        notification.style.background = colors[type] || colors.info;
        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => notification.remove(), 300);
            }
        }, 3000);
    }

    autoDetectType() {
        if (!this.isEditorsReady) {
            this.showError('Редакторы еще не загружены');
            return;
        }

        const sourceCode = this.sourceEditor.getValue();
        const detectedType = this.detectTypeFromContent(sourceCode);
        document.getElementById('sourceType').value = detectedType;
        this.setEditorLanguage(detectedType);
        this.showSuccess(`Тип модели определен как: ${detectedType}`);
    }

    detectTypeFromContent(content) {
        if (content.includes('@prefix') || content.includes('PREFIX')) return 'owl';
        if (content.includes('<?xml') && content.includes('rdf:RDF')) return 'rdf';
        return 'text';
    }

    setEditorLanguage(language) {
        if (!this.isEditorsReady) return;
        
        const languageMap = {
            'owl': 'turtle',
            'rdf': 'xml',
            'text': 'text'
        };
        
        monaco.editor.setModelLanguage(this.sourceEditor.getModel(), languageMap[language] || 'text');
    }

    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const content = await this.readFileContent(file);
            this.sourceEditor.setValue(content);
            this.autoDetectTypeFromContent(content, file.name);
            this.showSuccess(`Файл "${file.name}" успешно загружен`);
        } catch (error) {
            this.showError(`Ошибка загрузки файла: ${error.message}`);
        }
    }

    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }

    autoDetectTypeFromContent(content, filename) {
        const extension = filename.split('.').pop().toLowerCase();
        const typeMap = {
            'owl': 'owl',
            'ttl': 'owl',
            'rdf': 'rdf',
            'txt': 'auto'
        };

        const detectedType = typeMap[extension] || this.detectTypeFromContent(content);
        document.getElementById('sourceType').value = detectedType;
        this.setEditorLanguage(detectedType);
    }

    validateSource() {
        this.showInfo('Валидация еще не реализована');
    }

    formatSource() {
        this.showInfo('Форматирование еще не реализовано');
    }

    convertToIfc() {
        if (!this.isEditorsReady) {
            this.showError('Редакторы еще не загружены');
            return;
        }

        const sourceCode = this.sourceEditor.getValue();
        const sourceType = document.getElementById('sourceType').value;
        
        if (!sourceCode.trim() || sourceCode.includes('// Вставьте вашу исходную модель здесь')) {
            this.showError('Исходная модель пуста или содержит только пример');
            return;
        }
        
        try {
            // Парсинг исходной модели
            const sourceModel = this.parseSourceModel(sourceCode, sourceType);
            
            // Создание и отображение маппинга
            this.createAndDisplayMapping(sourceModel);
            
            this.showSuccess('Соответствия сгенерированы! Настройте маппинг и экспортируйте результат.');
            
        } catch (error) {
            this.showError(`Ошибка преобразования: ${error.message}`);
        }
    }

    parseSourceModel(sourceCode, sourceType) {
        switch (sourceType) {
            case 'owl':
                return this.parseOwlTurtle(sourceCode);
            case 'rdf':
                return this.parseOwlRdf(sourceCode);
            default:
                throw new Error(`Неподдерживаемый тип исходной модели: ${sourceType}`);
        }
    }

    parseOwlTurtle(turtleCode) {
        const classes = [];
        const classRegex = /:(\w+)\s+a\s+owl:Class/g;
        let match;
        
        while ((match = classRegex.exec(turtleCode)) !== null) {
            classes.push({
                name: match[1],
                type: 'Class'
            });
        }

        const properties = [];
        const propRegex = /:(\w+)\s+a\s+owl:(ObjectProperty|DatatypeProperty)/g;
        
        while ((match = propRegex.exec(turtleCode)) !== null) {
            properties.push({
                name: match[1],
                type: match[2]
            });
        }
        
        return {
            type: 'owl-turtle',
            classes: classes,
            properties: properties
        };
    }

    parseOwlRdf(rdfCode) {
        const classes = [];
        const classRegex = /<owl:Class rdf:ID="(\w+)">/g;
        let match;
        
        while ((match = classRegex.exec(rdfCode)) !== null) {
            classes.push({
                name: match[1],
                type: 'Class'
            });
        }
        
        return {
            type: 'owl-rdf',
            classes: classes,
            properties: []
        };
    }

    createAndDisplayMapping(sourceModel) {
        // Создаем объект маппинга
        this.currentMapping = {
            sourceType: sourceModel.type,
            classMappings: [],
            attributeMappings: [],
            timestamp: new Date().toISOString()
        };

        // Заполняем маппинг классов
        if (sourceModel.classes && sourceModel.classes.length > 0) {
            sourceModel.classes.forEach(cls => {
                const defaultMapping = this.getDefaultClassMapping(cls.name);
                this.currentMapping.classMappings.push({
                    source: cls.name,
                    target: defaultMapping,
                    type: 'class'
                });
            });
        }

        // Заполняем маппинг атрибутов
        if (sourceModel.properties && sourceModel.properties.length > 0) {
            sourceModel.properties.forEach(prop => {
                const defaultMapping = this.getDefaultAttributeMapping(prop.name);
                this.currentMapping.attributeMappings.push({
                    source: prop.name,
                    target: defaultMapping,
                    type: 'attribute'
                });
            });
        }

        // Отображаем маппинг в интерфейсе
        this.displayClassMapping();
        this.displayAttributeMapping();

        // Переключаемся на вкладку классов
        this.switchTab('class-mapping');
    }

    getDefaultClassMapping(className) {
        const defaultMappings = {
            'Building': 'IfcBuilding',
            'Wall': 'IfcWall',
            'Door': 'IfcDoor',
            'Window': 'IfcWindow',
            'Space': 'IfcSpace',
            'Floor': 'IfcSlab',
            'Roof': 'IfcRoof',
            'Beam': 'IfcBeam',
            'Column': 'IfcColumn'
        };
        return defaultMappings[className] || 'IfcProduct';
    }

    getDefaultAttributeMapping(attributeName) {
        const defaultMappings = {
            'hasHeight': 'OverallHeight',
            'hasMaterial': 'Material',
            'hasWidth': 'OverallWidth',
            'hasLength': 'OverallLength',
            'hasArea': 'GrossArea',
            'hasVolume': 'GrossVolume'
        };
        return defaultMappings[attributeName] || attributeName.toUpperCase();
    }

    displayClassMapping() {
        const container = document.getElementById('classMappingList');
        container.innerHTML = '';

        if (this.currentMapping.classMappings.length === 0) {
            container.innerHTML = '<div class="no-mappings">Классы не найдены в исходной модели</div>';
            return;
        }

        this.currentMapping.classMappings.forEach((mapping, index) => {
            const item = document.createElement('div');
            item.className = 'mapping-item';
            item.innerHTML = `
                <div class="source-item">${mapping.source}</div>
                <div class="target-item">
                    <select class="mapping-select" data-index="${index}" data-type="class">
                        ${this.ifcClasses.map(cls => 
                            `<option value="${cls}" ${cls === mapping.target ? 'selected' : ''}>${cls}</option>`
                        ).join('')}
                        <option value="custom">-- Другое --</option>
                    </select>
                    <input type="text" class="mapping-input" 
                           value="${!this.ifcClasses.includes(mapping.target) ? mapping.target : ''}" 
                           placeholder="Введите IFC класс" 
                           style="${this.ifcClasses.includes(mapping.target) ? 'display:none' : ''}">
                </div>
            `;
            container.appendChild(item);
        });

        // Добавляем обработчики событий
        this.bindMappingEvents('class');
    }

    displayAttributeMapping() {
        const container = document.getElementById('attributeMappingList');
        container.innerHTML = '';

        if (this.currentMapping.attributeMappings.length === 0) {
            container.innerHTML = '<div class="no-mappings">Атрибуты не найдены в исходной модели</div>';
            return;
        }

        this.currentMapping.attributeMappings.forEach((mapping, index) => {
            const item = document.createElement('div');
            item.className = 'mapping-item';
            item.innerHTML = `
                <div class="source-item">${mapping.source}</div>
                <div class="target-item">
                    <select class="mapping-select" data-index="${index}" data-type="attribute">
                        <option value="">-- Выберите атрибут --</option>
                        ${this.ifcAttributes.map(attr => 
                            `<option value="${attr}" ${attr === mapping.target ? 'selected' : ''}>${attr}</option>`
                        ).join('')}
                        <option value="custom" ${!this.ifcAttributes.includes(mapping.target) ? 'selected' : ''}>-- Другое --</option>
                    </select>
                    <input type="text" class="mapping-input" 
                           value="${!this.ifcAttributes.includes(mapping.target) ? mapping.target : ''}" 
                           placeholder="Введите IFC атрибут"
                           style="${this.ifcAttributes.includes(mapping.target) ? 'display:none' : ''}">
                </div>
            `;
            container.appendChild(item);
        });

        // Добавляем обработчики событий
        this.bindMappingEvents('attribute');
    }

    bindMappingEvents(type) {
        const selects = document.querySelectorAll(`.mapping-select[data-type="${type}"]`);
        const inputs = document.querySelectorAll(`.mapping-input`);

        selects.forEach(select => {
            select.addEventListener('change', (e) => {
                const index = parseInt(e.target.getAttribute('data-index'));
                const input = e.target.parentNode.querySelector('.mapping-input');
                
                if (e.target.value === 'custom') {
                    input.style.display = 'block';
                    input.focus();
                } else {
                    input.style.display = 'none';
                    this.updateMapping(type, index, e.target.value);
                }
            });
        });

        inputs.forEach(input => {
            input.addEventListener('input', (e) => {
                const select = e.target.parentNode.querySelector('.mapping-select');
                const index = parseInt(select.getAttribute('data-index'));
                this.updateMapping(type, index, e.target.value);
            });

            input.addEventListener('blur', (e) => {
                if (!e.target.value.trim()) {
                    const select = e.target.parentNode.querySelector('.mapping-select');
                    select.value = '';
                    e.target.style.display = 'none';
                }
            });
        });
    }

    updateMapping(type, index, value) {
        if (type === 'class') {
            this.currentMapping.classMappings[index].target = value;
        } else {
            this.currentMapping.attributeMappings[index].target = value;
        }
    }

    exportMapping() {
        if (!this.currentMapping) {
            this.showError('Сначала выполните преобразование для создания маппинга');
            return;
        }
        
        let mappingText = "СООТВЕТСТВИЯ OWL → IFC\n";
        mappingText += "========================\n\n";
        mappingText += `Дата создания: ${new Date().toLocaleString()}\n`;
        mappingText += `Тип исходной модели: ${this.currentMapping.sourceType}\n\n`;
        
        mappingText += "СОПОСТАВЛЕНИЕ КЛАССОВ:\n";
        mappingText += "---------------------\n";
        this.currentMapping.classMappings.forEach((item, index) => {
            mappingText += `${index + 1}. ${item.source} → ${item.target}\n`;
        });
        
        mappingText += "\nСОПОСТАВЛЕНИЕ АТРИБУТОВ:\n";
        mappingText += "-----------------------\n";
        this.currentMapping.attributeMappings.forEach((item, index) => {
            mappingText += `${index + 1}. ${item.source} → ${item.target}\n`;
        });
        
        mappingText += `\nВсего классов: ${this.currentMapping.classMappings.length}`;
        mappingText += `\nВсего атрибутов: ${this.currentMapping.attributeMappings.length}`;
        
        const blob = new Blob([mappingText], { type: 'text/plain; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mapping_${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showSuccess('Соответствия экспортированы в файл');
    }

    downloadIfc() {
        this.showInfo('Генерация IFC будет реализована в следующей версии');
    }

    toggleFullscreen(editorType) {
        const panel = editorType === 'source' 
            ? document.querySelector('.editor-panel:first-child')
            : document.querySelector('.editor-panel:last-child');
        
        const button = editorType === 'source'
            ? document.getElementById('fullscreenSourceBtn')
            : document.getElementById('fullscreenTargetBtn');
        
        if (panel.classList.contains('fullscreen')) {
            panel.classList.remove('fullscreen');
            button.textContent = '⛶';
            document.body.style.overflow = 'auto';
        } else {
            panel.classList.add('fullscreen');
            button.textContent = '⧉';
            document.body.style.overflow = 'hidden';
            this.refreshEditor(editorType);
        }
    }

    refreshEditor(editorType) {
        setTimeout(() => {
            if (editorType === 'source' && this.sourceEditor) {
                this.sourceEditor.layout();
            } else if (editorType === 'target' && this.targetEditor) {
                this.targetEditor.layout();
            }
        }, 100);
    }

    showAdvancedSettings() {
        document.getElementById('advancedModal').style.display = 'block';
    }

    hideAdvancedSettings() {
        document.getElementById('advancedModal').style.display = 'none';
    }

    saveAdvancedSettings() {
        this.hideAdvancedSettings();
        this.showSuccess('Настройки сохранены');
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new IfcModelMapper();
});

// Добавляем CSS анимации для уведомлений
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
    }
    
    @keyframes slideOut {
        from { transform: translateX(0); opacity: 1; }
        to { transform: translateX(100%); opacity: 0; }
    }
`;
document.head.appendChild(style);
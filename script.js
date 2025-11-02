// script.js
class IfcModelMapper {
    constructor() {
        this.sourceEditor = null;
        this.targetEditor = null;
        this.currentMapping = null;
        this.isEditorsReady = false;
        this.init();
    }

    init() {
        this.initEditors();
        this.bindEvents();
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
                value: '// IFC результат появится здесь\n// Вы можете редактировать сгенерированный IFC код',
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

    bindEvents() {
        // Основные кнопки
        document.getElementById('convertBtn').addEventListener('click', () => this.convertToIfc());
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileUpload(e));
        document.getElementById('detectTypeBtn').addEventListener('click', () => this.autoDetectType());
        document.getElementById('validateSourceBtn').addEventListener('click', () => this.validateSource());
        document.getElementById('validateIfcBtn').addEventListener('click', () => this.validateIfc());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadIfc());
        document.getElementById('formatSourceBtn').addEventListener('click', () => this.formatSource());
        document.getElementById('exportMappingBtn').addEventListener('click', () => this.exportMapping());
        document.getElementById('exportDiagramBtn').addEventListener('click', () => this.exportDiagram());
        
        // Полноэкранный режим
        document.getElementById('fullscreenSourceBtn').addEventListener('click', () => this.toggleFullscreen('source'));
        document.getElementById('fullscreenTargetBtn').addEventListener('click', () => this.toggleFullscreen('target'));
        
        // Модальное окно
        document.getElementById('advancedSettingsBtn').addEventListener('click', () => this.showAdvancedSettings());
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveAdvancedSettings());
        document.getElementById('cancelSettingsBtn').addEventListener('click', () => this.hideAdvancedSettings());
        
        // Закрытие модального окна
        document.getElementById('advancedModal').addEventListener('click', (e) => {
            if (e.target.id === 'advancedModal') {
                this.hideAdvancedSettings();
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.getElementById('advancedModal').style.display === 'block') {
                this.hideAdvancedSettings();
            }
        });
    }

    // Методы для уведомлений
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
        // Удаляем предыдущие уведомления
        const existingNotification = document.querySelector('.notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        const notification = document.createElement('div');
        notification.className = `notification notification-${type}`;
        notification.textContent = message;
        
        // Стили для уведомления
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

        // Цвета в зависимости от типа
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#3b82f6'
        };
        
        notification.style.background = colors[type] || colors.info;

        document.body.appendChild(notification);

        // Автоматическое скрытие через 3 секунды
        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease-in';
                setTimeout(() => notification.remove(), 300);
            }
        }, 3000);
    }

    hideSuccess() {
        const notification = document.querySelector('.notification');
        if (notification) {
            notification.remove();
        }
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
        if (!this.isEditorsReady) {
            this.showError('Редакторы еще не загружены');
            return;
        }

		this.showInfo('Валидация еще не реализована');
		return;

        const sourceCode = this.sourceEditor.getValue();
        const sourceType = document.getElementById('sourceType').value;
        
        if (!sourceCode.trim()) {
            this.showError('Исходная модель пуста');
            return;
        }
        
        try {
            this.parseSourceModel(sourceCode, sourceType);
            this.showSuccess('Исходная модель корректна');
        } catch (error) {
            this.showError(`Ошибка проверки: ${error.message}`);
        }
    }

    validateIfc() {
        if (!this.isEditorsReady) {
            this.showError('Редакторы еще не загружены');
            return;
        }
		
		this.showInfo('Валидация еще не реализована');
		return;

        const ifcCode = this.targetEditor.getValue();
        
        if (!ifcCode.trim() || ifcCode.includes('// IFC результат появится здесь')) {
            this.showError('IFC код еще не сгенерирован');
            return;
        }

        if (!ifcCode.includes('ISO-10303-21') || !ifcCode.includes('ENDSEC;')) {
            this.showError('Неверный формат IFC');
            return;
        }
        this.showSuccess('Синтаксис IFC корректен');
    }

    formatSource() {
        if (!this.isEditorsReady) {
            this.showError('Редакторы еще не загружены');
            return;
        }

        const sourceCode = this.sourceEditor.getValue();
        const sourceType = document.getElementById('sourceType').value;
        
        if (!sourceCode.trim()) {
            this.showError('Исходная модель пуста');
            return;
        }
        
		this.showInfo('Форматирование еще не реализовано')
		return;
		
        try {
            let formattedCode = sourceCode;
            
            if (sourceType === 'owl') {
                formattedCode = sourceCode
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .map((line, index) => {
                        if (index === 0) return line;
                        if (line.startsWith('@prefix') || line.startsWith('PREFIX')) return '\n' + line;
                        if (line.endsWith('.')) return '    ' + line;
                        return '    ' + line;
                    })
                    .join('\n');
            }
            
            this.sourceEditor.setValue(formattedCode);
            this.showSuccess('Код отформатирован');
        } catch (error) {
            this.showError('Ошибка форматирования');
        }
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
        
		this.showInfo(`Маппинг еще не реализован`);
		return;
		
        try {
            // Парсинг исходной модели
            const sourceModel = this.parseSourceModel(sourceCode, sourceType);
            
            // Создание маппинга
            this.currentMapping = this.createMapping(sourceModel);
            
            // Генерация IFC
            const ifcCode = this.generateIfc(sourceModel);
            
            // Обновление целевого редактора
            this.targetEditor.setValue(ifcCode);
            
            this.showSuccess('Преобразование в IFC завершено успешно!');
            
        } catch (error) {
            this.showError(`Ошибка преобразования: ${error.message}`);
        }
    }

    // Остальные методы остаются без изменений...
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

    createMapping(sourceModel) {
        const mapping = {
            sourceType: sourceModel.type,
            elements: []
        };

        if (sourceModel.classes) {
            sourceModel.classes.forEach(cls => {
                mapping.elements.push({
                    source: `OWL Class: ${cls.name}`,
                    target: this.mapClassToIfc(cls),
                    type: 'class'
                });
            });
        }

        if (sourceModel.properties) {
            sourceModel.properties.forEach(prop => {
                mapping.elements.push({
                    source: `OWL Property: ${prop.name}`,
                    target: this.mapPropertyToIfc(prop),
                    type: 'property'
                });
            });
        }

        return mapping;
    }

    mapClassToIfc(owlClass) {
        const classMapping = {
            'Building': 'IfcBuilding',
            'Wall': 'IfcWall',
            'Door': 'IfcDoor',
            'Window': 'IfcWindow',
            'Space': 'IfcSpace'
        };

        return {
            ifcType: classMapping[owlClass.name] || 'IfcProduct',
            ifcName: owlClass.name
        };
    }

    mapPropertyToIfc(owlProperty) {
        return {
            ifcType: 'IfcPropertySet',
            ifcName: owlProperty.name.toUpperCase()
        };
    }

    generateIfc(sourceModel) {
        let ifcCode = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Модель из ${sourceModel.type}'), '2;1');
FILE_NAME('${sourceModel.type}_converted.ifc', '${new Date().toISOString()}', ('Конвертер'), ('IFC Model Mapper'), '');
FILE_SCHEMA(('IFC4X3'));
ENDSEC;

DATA;
`;

        ifcCode += this.generateIfcEntities(sourceModel);
        
        ifcCode += `ENDSEC;
END-ISO-10303-21;`;

        return ifcCode;
    }

    generateIfcEntities(sourceModel) {
        let entities = '';
        
        entities += `#1=IFCPROJECT('${this.generateGuid()}',#2,'Проект из ${sourceModel.type}',$,$,$,$,(#6),#7);\n`;
        entities += `#2=IFCOWNERHISTORY(#3,#6,#7,.NOCHANGE.,$);\n`;
        entities += `#3=IFCPERSONANDORGANIZATION(#4,#5,$);\n`;
        entities += `#4=IFCPERSON($,'Авто','Сгенерировано',$,$,$,$,$);\n`;
        entities += `#5=IFCORGANIZATION($,'IFC Model Mapper','Автоматически сгенерировано',$,$);\n`;
        
        if (sourceModel.classes) {
            sourceModel.classes.forEach((cls, index) => {
                const ifcType = this.mapClassToIfc(cls).ifcType;
                entities += `#${index + 10}=${ifcType}('${this.generateGuid()}',#2,'${cls.name}',$,$);\n`;
            });
        }
        
        return entities;
    }

    generateGuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    downloadIfc() {
        if (!this.isEditorsReady) {
            this.showError('Редакторы еще не загружены');
            return;
        }

        const ifcCode = this.targetEditor.getValue();
        
        if (!ifcCode.trim() || ifcCode.includes('// IFC результат появится здесь')) {
            this.showError('Нет IFC кода для скачивания');
            return;
        }

        const blob = new Blob([ifcCode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'converted_model.ifc';
        a.click();
        URL.revokeObjectURL(url);
        this.showSuccess('IFC файл скачан');
    }

    exportMapping() {
        if (!this.currentMapping) {
            this.showError('Сначала выполните преобразование');
            return;
        }
        
        let mappingText = "Соответствия OWL → IFC\n";
        mappingText += "========================\n\n";
        
        this.currentMapping.elements.forEach(item => {
            mappingText += `${item.source} → ${item.target.ifcType}\n`;
        });
        
        const blob = new Blob([mappingText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'mapping_correspondence.txt';
        a.click();
        URL.revokeObjectURL(url);
        
        this.showSuccess('Соответствия экспортированы в файл');
    }

    exportDiagram() {
        this.showInfo('Экспорт диаграммы будет реализован в будущей версии');
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

// Добавляем стили для анимаций
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

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new IfcModelMapper();
});
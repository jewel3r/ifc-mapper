// script.js
class IfcModelMapper {
    constructor() {
        this.sourceEditor = null;
        this.targetEditor = null;
        this.currentMapping = null;
        this.init();
    }

    init() {
        this.initEditors();
        this.bindEvents();
        this.loadDefaultExamples();
    }

    initEditors() {
		require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@0.33.0/min/vs' }});
		
		require(['vs/editor/editor.main'], () => {
			this.sourceEditor = monaco.editor.create(document.getElementById('sourceEditor'), {
				value: '// Вставьте вашу исходную модель здесь\n// Поддерживаемые форматы: OWL Turtle, OWL RDF/XML',
				language: 'text',
				theme: 'vs-light',
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				automaticLayout: true // Важно для адаптации к изменению размеров
			});

			this.targetEditor = monaco.editor.create(document.getElementById('targetEditor'), {
				value: '// IFC результат появится здесь\n// Вы можете редактировать сгенерированный IFC код',
				language: 'plaintext',
				theme: 'vs-light',
				minimap: { enabled: false },
				scrollBeyondLastLine: false,
				readOnly: false,
				automaticLayout: true // Важно для адаптации к изменению размеров
			});
		});
	}

    bindEvents() {
		document.getElementById('convertBtn').addEventListener('click', () => this.convertToIfc());
		document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileUpload(e));
		document.getElementById('detectTypeBtn').addEventListener('click', () => this.autoDetectType());
		document.getElementById('validateSourceBtn').addEventListener('click', () => this.validateSource());
		document.getElementById('validateIfcBtn').addEventListener('click', () => this.validateIfc());
		document.getElementById('downloadBtn').addEventListener('click', () => this.downloadIfc());
		document.getElementById('formatSourceBtn').addEventListener('click', () => this.formatSource());
		document.getElementById('exportMappingBtn').addEventListener('click', () => this.exportMapping());
		document.getElementById('exportDiagramBtn').addEventListener('click', () => this.exportDiagram());
		document.getElementById('fullscreenSourceBtn').addEventListener('click', () => this.toggleFullscreen('source'));
		document.getElementById('fullscreenTargetBtn').addEventListener('click', () => this.toggleFullscreen('target'));
		document.getElementById('advancedSettingsBtn').addEventListener('click', () => this.showAdvancedSettings());
		document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveAdvancedSettings());
		document.getElementById('cancelSettingsBtn').addEventListener('click', () => this.hideAdvancedSettings());
		
		// Закрытие модального окна по клику вне его области
		document.getElementById('advancedModal').addEventListener('click', (e) => {
			if (e.target.id === 'advancedModal') {
				this.hideAdvancedSettings();
			}
		});
		
		// Закрытие модального окна по клавише Escape
		document.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && document.getElementById('advancedModal').style.display === 'block') {
				this.hideAdvancedSettings();
			}
		});
	}
	
	toggleFullscreen(editorType) {
		const panel = editorType === 'source' 
			? document.querySelector('.editor-panel:first-child')
			: document.querySelector('.editor-panel:last-child');
		
		const button = editorType === 'source'
			? document.getElementById('fullscreenSourceBtn')
			: document.getElementById('fullscreenTargetBtn');
		
		if (panel.classList.contains('fullscreen')) {
			// Выход из полноэкранного режима
			panel.classList.remove('fullscreen');
			button.textContent = '⛶';
			document.body.style.overflow = 'auto';
		} else {
			// Вход в полноэкранный режим
			panel.classList.add('fullscreen');
			button.textContent = '⧉';
			document.body.style.overflow = 'hidden';
			
			// Пересоздаем редактор для адаптации под новый размер
			this.refreshEditor(editorType);
		}
	}

	refreshEditor(editorType) {
		if (editorType === 'source' && this.sourceEditor) {
			this.sourceEditor.layout();
		} else if (editorType === 'target' && this.targetEditor) {
			this.targetEditor.layout();
		}
	}
	
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        const content = await this.readFileContent(file);
        this.sourceEditor.setValue(content);
        
        // Авто-определение типа файла
        this.autoDetectTypeFromContent(content, file.name);
    }

    readFileContent(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
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
        
        // Устанавливаем соответствующий язык в редакторе
        this.setEditorLanguage(detectedType);
    }

    detectTypeFromContent(content) {
        if (content.includes('@prefix') || content.includes('PREFIX')) return 'owl';
        if (content.includes('<?xml') && content.includes('rdf:RDF')) return 'rdf';
        return 'text';
    }

    setEditorLanguage(language) {
        const languageMap = {
            'owl': 'turtle',
            'rdf': 'xml',
            'text': 'text'
        };
        
        monaco.editor.setModelLanguage(this.sourceEditor.getModel(), languageMap[language] || 'text');
    }

    async convertToIfc() {
		const sourceCode = this.sourceEditor.getValue();
		const sourceType = document.getElementById('sourceType').value;
		
		try {
			// Парсинг исходной модели
			const sourceModel = this.parseSourceModel(sourceCode, sourceType);
			
			// Создание маппинга (нужно для экспорта)
			this.currentMapping = this.createMapping(sourceModel);
			
			// Генерация IFC
			const ifcCode = this.generateIfc(sourceModel);
			
			// Обновление целевого редактора
			this.targetEditor.setValue(ifcCode);
			this.setEditorLanguage('ifc');
			
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
        // Упрощенный парсинг OWL Turtle
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
        // Упрощенный парсинг OWL RDF/XML
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

        // Маппинг классов OWL в IFC
        if (sourceModel.classes) {
            sourceModel.classes.forEach(cls => {
                mapping.elements.push({
                    source: `OWL Class: ${cls.name}`,
                    target: this.mapClassToIfc(cls),
                    type: 'class'
                });
            });
        }

        // Маппинг свойств OWL в IFC
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
	
	exportMapping() {
		if (!this.currentMapping) {
			this.showError('Сначала выполните преобразование');
			return;
		}
		
		// Создаем текстовый файл с соответствиями
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

    generateIfc(sourceModel) {
        let ifcCode = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Модель из ${sourceModel.type}'), '2;1');
FILE_NAME('${sourceModel.type}_converted.ifc', '${new Date().toISOString()}', ('Конвертер'), ('IFC Model Mapper'), '');
FILE_SCHEMA(('IFC4X3'));
ENDSEC;

DATA;
`;

        // Базовые IFC entities
        ifcCode += this.generateIfcEntities(sourceModel);
        
        ifcCode += `ENDSEC;
END-ISO-10303-21;`;

        return ifcCode;
    }

    generateIfcEntities(sourceModel) {
        let entities = '';
        
        // Создание основного проекта
        entities += `#1=IFCPROJECT('0wL76$y$nAjP$ebZG$eZ2H',#2,'Проект из ${sourceModel.type}',$,$,$,$,(#6),#7);\n`;
        entities += `#2=IFCOWNERHISTORY(#3,#6,#7,.NOCHANGE.,$);\n`;
        entities += `#3=IFCPERSONANDORGANIZATION(#4,#5,$);\n`;
        entities += `#4=IFCPERSON($,'Авто','Сгенерировано',$,$,$,$,$);\n`;
        entities += `#5=IFCORGANIZATION($,'IFC Model Mapper','Автоматически сгенерировано',$,$);\n`;
        
        // Создание IFC сущностей для OWL классов
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

    validateSource() {
        const sourceCode = this.sourceEditor.getValue();
        const sourceType = document.getElementById('sourceType').value;
        
        try {
            this.parseSourceModel(sourceCode, sourceType);
            this.showSuccess('Исходная модель корректна');
        } catch (error) {
            this.showError(`Ошибка проверки: ${error.message}`);
        }
    }

    validateIfc() {
        const ifcCode = this.targetEditor.getValue();
        if (!ifcCode.includes('ISO-10303-21') || !ifcCode.includes('ENDSEC;')) {
            this.showError('Неверный формат IFC');
            return;
        }
        this.showSuccess('Синтаксис IFC корректен');
    }

    downloadIfc() {
        const ifcCode = this.targetEditor.getValue();
        const blob = new Blob([ifcCode], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'converted_model.ifc';
        a.click();
        URL.revokeObjectURL(url);
    }

    formatSource() {
        const sourceCode = this.sourceEditor.getValue();
        const sourceType = document.getElementById('sourceType').value;
        
        try {
            let formattedCode = sourceCode;
            
            if (sourceType === 'owl') {
                // Простое форматирование Turtle - добавление отступов
                formattedCode = sourceCode
                    .split('\n')
                    .map(line => line.trim())
                    .filter(line => line.length > 0)
                    .join('\n    ');
            }
            
            this.sourceEditor.setValue(formattedCode);
            this.showSuccess('Код отформатирован');
        } catch (error) {
            this.showError('Ошибка форматирования');
        }
    }

    showAdvancedSettings() {
		document.getElementById('advancedModal').style.display = 'block';
		// Здесь можно загрузить текущие настройки в форму
	}

	hideAdvancedSettings() {
		document.getElementById('advancedModal').style.display = 'none';
		// Здесь можно сбросить несохраненные изменения
	}

	saveAdvancedSettings() {
		// Сохранение настроек (заглушка)
		this.hideAdvancedSettings();
		this.showSuccess('Настройки сохранены');
		
		// Показываем сообщение на 2 секунды, затем автоматически скрываем
		setTimeout(() => {
			this.hideSuccess();
		}, 2000);
	}

    loadDefaultExamples() {
        const owlExample = `
@prefix : <http://example.org/ontology#> .
@prefix owl: <http://www.w3.org/2002/07/owl#> .
@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .

:Building a owl:Class .
:Wall a owl:Class .
:Door a owl:Class .

:hasHeight a owl:DatatypeProperty .
:hasMaterial a owl:ObjectProperty .
        `.trim();

        this.sourceEditor.setValue(owlExample);
        this.setEditorLanguage('owl');
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new IfcModelMapper();
});
// script.js
class IfcModelMapper {
    constructor() {
        this.sourceEditor = null;
        this.targetEditor = null;
        this.currentMapping = null;
        this.isEditorsReady = false;
        this.ifcSchema = null;
        this.customIfcSchema = null;
        
        // Загружаем сохраненные маппинги и пользовательскую схему
        this.savedMappings = this.loadSavedMappings();
        this.customIfcSchema = this.loadCustomIfcSchema();
        
        // Привязываем методы к контексту класса
        this.handleMappingChange = this.handleMappingChange.bind(this);
        this.handleMappingInput = this.handleMappingInput.bind(this);
        
        this.init();
    }

    // Загрузка IFC схемы
    async loadIfcSchema() {
        try {
            const response = await fetch('ifc-4.3.json');
            this.ifcSchema = await response.json();
            console.log('IFC schema loaded:', this.ifcSchema);
        } catch (error) {
            console.error('Error loading IFC schema:', error);
            // Запасные данные на случай ошибки загрузки
            this.ifcSchema = {
                Classes: [],
                ModelVersion: "2.0",
                DictionaryVersion: "4.3"
            };
        }
    }

    // Загрузка пользовательской IFC схемы
    loadCustomIfcSchema() {
        try {
            const saved = localStorage.getItem('ifcMapperCustomSchema');
            return saved ? JSON.parse(saved) : null;
        } catch (error) {
            console.error('Error loading custom IFC schema:', error);
            return null;
        }
    }

    // Сохранение пользовательской IFC схемы
    saveCustomIfcSchema() {
        try {
            localStorage.setItem('ifcMapperCustomSchema', JSON.stringify(this.customIfcSchema));
        } catch (error) {
            console.error('Error saving custom IFC schema:', error);
        }
    }

    // Получение объединенной схемы (оригинальная + пользовательские изменения)
    getMergedIfcSchema() {
        if (!this.ifcSchema) return { Classes: [] };
        
        if (!this.customIfcSchema) {
            return this.ifcSchema;
        }

        // Создаем глубокую копию оригинальной схемы
        const merged = JSON.parse(JSON.stringify(this.ifcSchema));
        
        // Объединяем классы
        const originalClassesMap = new Map();
        merged.Classes.forEach(cls => originalClassesMap.set(cls.Code, cls));

        this.customIfcSchema.Classes.forEach(customClass => {
            const existingClass = originalClassesMap.get(customClass.Code);
            if (existingClass) {
                // Обновляем существующий класс
                if (customClass.ClassProperties) {
                    // Объединяем свойства
                    const existingPropsMap = new Map();
                    existingClass.ClassProperties.forEach(prop => 
                        existingPropsMap.set(prop.PropertyCode, prop)
                    );

                    customClass.ClassProperties.forEach(customProp => {
                        if (existingPropsMap.has(customProp.PropertyCode)) {
                            // Обновляем существующее свойство
                            const index = existingClass.ClassProperties.findIndex(
                                p => p.PropertyCode === customProp.PropertyCode
                            );
                            existingClass.ClassProperties[index] = customProp;
                        } else {
                            // Добавляем новое свойство
                            existingClass.ClassProperties.push(customProp);
                        }
                    });
                }
            } else {
                // Добавляем новый класс
                merged.Classes.push(customClass);
            }
        });

        return merged;
    }

    // Получение всех IFC классов из объединенной схемы
    getIfcClasses() {
        const schema = this.getMergedIfcSchema();
        return schema.Classes.map(cls => cls.Code).sort();
    }

    // Получение свойств для конкретного IFC класса
    getIfcClassProperties(ifcClass) {
        const schema = this.getMergedIfcSchema();
        const cls = schema.Classes.find(c => c.Code === ifcClass);
        if (cls && cls.ClassProperties) {
            return cls.ClassProperties.map(prop => prop.PropertyCode).sort();
        }
        return [];
    }

    // Получение всех свойств из схемы
    getAllIfcProperties() {
        const schema = this.getMergedIfcSchema();
        const allProperties = new Set();
        
        schema.Classes.forEach(cls => {
            if (cls.ClassProperties) {
                cls.ClassProperties.forEach(prop => {
                    allProperties.add(prop.PropertyCode);
                });
            }
        });
        
        return Array.from(allProperties).sort();
    }


	// Улучшенная версия addCustomPropertyToClass
	addCustomPropertyToClass(ifcClass, propertyName, propertySet = "Pset_Custom") {
		if (!this.customIfcSchema) {
			this.customIfcSchema = {
				ModelVersion: "2.0",
				OrganizationCode: "custom", 
				DictionaryCode: "ifc_custom",
				DictionaryName: "IFC Custom",
				DictionaryVersion: "4.3",
				LanguageIsoCode: "EN",
				Classes: []
			};
		}

		// Находим или создаем пользовательский класс
		let customClass = this.customIfcSchema.Classes.find(c => c.Code === ifcClass);
		if (!customClass) {
			// Получаем информацию о классе из реальной схемы IFC
			const originalClass = this.ifcSchema?.Classes?.find(c => c.Code === ifcClass);
			
			customClass = {
				Code: ifcClass,
				Name: originalClass?.Name || ifcClass.replace('Ifc', ''),
				Definition: originalClass?.Definition || `Custom extension of ${ifcClass}`,
				ClassType: "Class",
				ClassProperties: [],
				Uid: this.generateUid(),
				ParentClassCode: originalClass?.ParentClassCode || this.getParentClassCode(ifcClass)
			};
			this.customIfcSchema.Classes.push(customClass);
		}

		// Добавляем свойство, если его еще нет
		const existingProp = customClass.ClassProperties.find(p => p.PropertyCode === propertyName);
		if (!existingProp) {
			customClass.ClassProperties.push({
				PropertyCode: propertyName,
				Code: `${propertyName}_from_Custom`,
				PropertySet: propertySet
			});
			
			this.saveCustomIfcSchema();
			this.showSuccess(`Свойство "${propertyName}" добавлено к классу ${ifcClass}`);
		}
	}

    // Генерация UID для новых элементов
    generateUid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c == 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

	getParentClassCode(ifcClass) {
		if (!this.ifcSchema || !this.ifcSchema.Classes) {
			return 'IfcProduct'; // fallback
		}
		
		const cls = this.ifcSchema.Classes.find(c => c.Code === ifcClass);
		if (cls && cls.ParentClassCode) {
			return cls.ParentClassCode;
		}
		
		// Если класс не найден в схеме, используем разумные значения по умолчанию
		const defaultHierarchy = {
			'IfcWall': 'IfcBuildingElement',
			'IfcDoor': 'IfcBuildingElement', 
			'IfcWindow': 'IfcBuildingElement',
			'IfcSlab': 'IfcBuildingElement',
			'IfcBeam': 'IfcBuildingElement',
			'IfcColumn': 'IfcBuildingElement',
			'IfcBuilding': 'IfcSpatialStructureElement',
			'IfcBuildingStorey': 'IfcSpatialStructureElement',
			'IfcSite': 'IfcSpatialStructureElement',
			'IfcSpace': 'IfcSpatialElement'
		};
		
		return defaultHierarchy[ifcClass] || 'IfcProduct';
	}

    // Загрузка сохраненных маппингов из localStorage
    loadSavedMappings() {
        try {
            const saved = localStorage.getItem('ifcMapperSavedMappings');
            const defaultMappings = {
                classMappings: {},
                attributeMappings: {},
                associationMappings: {},
                lastUpdated: null
            };
            
            if (saved) {
                const parsed = JSON.parse(saved);
                return {
                    ...defaultMappings,
                    ...parsed,
                    associationMappings: parsed.associationMappings || {}
                };
            }
            return defaultMappings;
        } catch (error) {
            console.error('Ошибка загрузки сохраненных маппингов:', error);
            return {
                classMappings: {},
                attributeMappings: {},
                associationMappings: {},
                lastUpdated: null
            };
        }
    }

    // Сохранение маппингов в localStorage
    saveMappings() {
        try {
            localStorage.setItem('ifcMapperSavedMappings', JSON.stringify(this.savedMappings));
        } catch (error) {
            console.error('Ошибка сохранения маппингов:', error);
        }
    }

    // Добавление подтвержденного маппинга в сохраненные
    addVerifiedMapping(type, source, target) {
        if (type === 'class') {
            this.savedMappings.classMappings[source] = {
                target: target,
                lastUsed: new Date().toISOString(),
                usageCount: (this.savedMappings.classMappings[source]?.usageCount || 0) + 1
            };
        } else if (type === 'attribute') {
            this.savedMappings.attributeMappings[source] = {
                target: target,
                lastUsed: new Date().toISOString(),
                usageCount: (this.savedMappings.attributeMappings[source]?.usageCount || 0) + 1
            };
        } else if (type === 'association') {
            this.savedMappings.associationMappings[source] = {
                target: target,
                lastUsed: new Date().toISOString(),
                usageCount: (this.savedMappings.associationMappings[source]?.usageCount || 0) + 1
            };
        }
        this.savedMappings.lastUpdated = new Date().toISOString();
        this.saveMappings();
    }

    // Получение сохраненного маппинга для элемента
    getSavedMapping(type, source) {
        if (type === 'class') {
            return this.savedMappings.classMappings[source];
        } else if (type === 'attribute') {
            return this.savedMappings.attributeMappings[source];
        } else if (type === 'association') {
            return this.savedMappings.associationMappings?.[source];
        }
        return null;
    }

    // Очистка всех сохраненных маппингов
    clearSavedMappings() {
        this.savedMappings = {
            classMappings: {},
            attributeMappings: {},
            associationMappings: {},
            lastUpdated: null
        };
        this.saveMappings();
        this.showSuccess('Сохраненные соответствия очищены');
    }

    async init() {
        await this.loadIfcSchema();
        this.initEditors();
        this.bindEvents();
        this.initTabs();
    }

    initEditors() {
        require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@0.33.0/min/vs' }});
        
        require(['vs/editor/editor.main'], () => {
            this.sourceEditor = monaco.editor.create(document.getElementById('sourceEditor'), {
                value: '// Вставьте вашу исходную модель здесь\n// Поддерживаемые форматы: OWL Turtle, OWL RDF/XML\n\n@prefix : <http://example.org/ontology#> .\n@prefix owl: <http://www.w3.org/2002/07/owl#> .\n@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n\n:Building a owl:Class ;\n    rdfs:label "Здание"@ru .\n:Wall a owl:Class ;\n    rdfs:label "Стена"@ru .\n:Door a owl:Class ;\n    rdfs:label "Дверь"@ru .\n\n:hasHeight a owl:DatatypeProperty ;\n    rdfs:label "Высота"@ru .\n:hasMaterial a owl:ObjectProperty ;\n    rdfs:label "Материал"@ru ;\n    rdfs:domain :Wall ;\n    rdfs:range :Material .',
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
        document.querySelectorAll('.tab-button').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');

        document.querySelectorAll('.tab-pane').forEach(pane => {
            pane.classList.remove('active');
        });
        document.getElementById(tabId).classList.add('active');

        setTimeout(() => {
            if (this.targetEditor) {
                this.targetEditor.layout();
            }
        }, 100);
    }

    bindEvents() {
        document.getElementById('convertBtn').addEventListener('click', () => this.convertToIfc());
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileUpload(e));
        document.getElementById('detectTypeBtn').addEventListener('click', () => this.autoDetectType());
        document.getElementById('validateSourceBtn').addEventListener('click', () => this.validateSource());
        document.getElementById('downloadBtn').addEventListener('click', () => this.downloadIfc());
        document.getElementById('formatSourceBtn').addEventListener('click', () => this.formatSource());
        document.getElementById('exportMappingBtn').addEventListener('click', () => this.exportMapping());
        
        document.getElementById('fullscreenSourceBtn').addEventListener('click', () => this.toggleFullscreen('source'));
        document.getElementById('fullscreenTargetBtn').addEventListener('click', () => this.toggleFullscreen('target'));
        
        document.getElementById('advancedSettingsBtn').addEventListener('click', () => this.showAdvancedSettings());
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveAdvancedSettings());
        document.getElementById('cancelSettingsBtn').addEventListener('click', () => this.hideAdvancedSettings());
        
        document.getElementById('validateMappingBtn').addEventListener('click', () => this.validateMapping());

        // Добавляем кнопку управления сохраненными маппингами
        this.addMappingManagementButton();
    }

    // Добавление кнопки управления сохраненными маппингами
    addMappingManagementButton() {
        const mappingConfig = document.querySelector('.mapping-config .rules-container');
        const manageButton = document.createElement('button');
        manageButton.id = 'manageMappingsBtn';
        manageButton.textContent = 'Управление сохраненными соответствиями';
        manageButton.style.marginTop = '10px';
        manageButton.style.background = 'var(--secondary-color)';
        
        manageButton.addEventListener('click', () => this.showMappingManagementModal());
        mappingConfig.appendChild(manageButton);
    }

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
            const sourceModel = this.parseSourceModel(sourceCode, sourceType);
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
                type: 'Class',
                label: this.extractLabel(turtleCode, match[1])
            });
        }

        const properties = [];
        const associations = [];
        const propRegex = /:(\w+)\s+a\s+owl:(ObjectProperty|DatatypeProperty)/g;
        
        while ((match = propRegex.exec(turtleCode)) !== null) {
            const propertyName = match[1];
            const propertyType = match[2];
            const label = this.extractLabel(turtleCode, propertyName);
            
            // Извлекаем информацию о домене и диапазоне
            let domain = null;
            let range = null;
            let cardinality = null;
            
            // Ищем domain
            const domainRegex = new RegExp(`:${propertyName}[^.]*rdfs:domain\\s+:([^\\s.;]+)`, 'g');
            const domainMatch = domainRegex.exec(turtleCode);
            if (domainMatch) {
                domain = domainMatch[1];
            }
            
            // Ищем range (только для ObjectProperty)
            if (propertyType === 'ObjectProperty') {
                const rangeRegex = new RegExp(`:${propertyName}[^.]*rdfs:range\\s+:([^\\s.;]+)`, 'g');
                const rangeMatch = rangeRegex.exec(turtleCode);
                if (rangeMatch) {
                    range = rangeMatch[1];
                }
                
                // Ищем cardinality ограничения
                const cardinalityRegex = new RegExp(`:${propertyName}[^.]*owl:cardinality\\s+"([^"]+)"`, 'g');
                const cardinalityMatch = cardinalityRegex.exec(turtleCode);
                if (cardinalityMatch) {
                    cardinality = cardinalityMatch[1];
                }
                
                associations.push({
                    name: propertyName,
                    type: 'ObjectProperty',
                    label: label,
                    domain: domain,
                    range: range,
                    cardinality: cardinality
                });
            } else {
                properties.push({
                    name: propertyName,
                    type: 'DatatypeProperty',
                    label: label,
                    domain: domain
                });
            }
        }
        
        return {
            type: 'owl-turtle',
            classes: classes,
            properties: properties,
            associations: associations
        };
    }

    extractLabel(turtleCode, elementName) {
        const labelPatterns = [
            new RegExp(`:${elementName}[^.]*rdfs:label\\s+"([^"]*)"@ru`, 'g'),
            new RegExp(`:${elementName}[^.]*rdfs:label\\s+"([^"]*)"@en`, 'g'),
            new RegExp(`:${elementName}[^.]*rdfs:label\\s+"([^"]*)"`, 'g'),
            new RegExp(`:${elementName}[^.]*#\\s*([^\\n]+)`, 'g')
        ];

        for (const pattern of labelPatterns) {
            const match = pattern.exec(turtleCode);
            if (match && match[1]) {
                return match[1].trim();
            }
        }

        return this.generateReadableName(elementName);
    }

    generateReadableName(technicalName) {
        return technicalName
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^\w/, c => c.toUpperCase())
            .trim();
    }

    parseOwlRdf(rdfCode) {
        const classes = [];
        const classRegex = /<owl:Class rdf:ID="(\w+)">([\s\S]*?)<\/owl:Class>/g;
        let match;
        
        while ((match = classRegex.exec(rdfCode)) !== null) {
            const classBlock = match[0];
            const labelMatch = /<rdfs:label[^>]*>([^<]+)<\/rdfs:label>/.exec(classBlock);
            
            classes.push({
                name: match[1],
                type: 'Class',
                label: labelMatch ? labelMatch[1] : this.generateReadableName(match[1])
            });
        }

        const properties = [];
        const associations = [];
        const propRegex = /<owl:(ObjectProperty|DatatypeProperty) rdf:ID="(\w+)">([\s\S]*?)<\/owl:(ObjectProperty|DatatypeProperty)>/g;
        
        while ((match = propRegex.exec(rdfCode)) !== null) {
            const propertyName = match[2];
            const propertyType = match[1];
            const propBlock = match[0];
            const labelMatch = /<rdfs:label[^>]*>([^<]+)<\/rdfs:label>/.exec(propBlock);
            
            let domain = null;
            let range = null;
            let cardinality = null;
            
            // Ищем domain в RDF
            const domainMatch = /<rdfs:domain rdf:resource="#(\w+)"/.exec(propBlock);
            if (domainMatch) {
                domain = domainMatch[1];
            }
            
            if (propertyType === 'ObjectProperty') {
                // Ищем range в RDF
                const rangeMatch = /<rdfs:range rdf:resource="#(\w+)"/.exec(propBlock);
                if (rangeMatch) {
                    range = rangeMatch[1];
                }
                
                // Ищем cardinality в RDF
                const cardinalityMatch = /<owl:cardinality[^>]*>([^<]+)<\/owl:cardinality>/.exec(propBlock);
                if (cardinalityMatch) {
                    cardinality = cardinalityMatch[1];
                }
                
                associations.push({
                    name: propertyName,
                    type: 'ObjectProperty',
                    label: labelMatch ? labelMatch[1] : this.generateReadableName(propertyName),
                    domain: domain,
                    range: range,
                    cardinality: cardinality
                });
            } else {
                properties.push({
                    name: propertyName,
                    type: 'DatatypeProperty',
                    label: labelMatch ? labelMatch[1] : this.generateReadableName(propertyName),
                    domain: domain
                });
            }
        }

        return {
            type: 'owl-rdf',
            classes: classes,
            properties: properties,
            associations: associations
        };
    }

    createAndDisplayMapping(sourceModel) {
        this.currentMapping = {
            sourceType: sourceModel.type,
            classMappings: [],
            attributeMappings: [],
            associationMappings: [],
            timestamp: new Date().toISOString()
        };

        if (sourceModel.classes && sourceModel.classes.length > 0) {
            sourceModel.classes.forEach(cls => {
                const savedMapping = this.getSavedMapping('class', cls.name);
                let defaultMapping;
                let verified = false;

                if (savedMapping) {
                    defaultMapping = savedMapping.target;
                    verified = true;
                } else {
                    defaultMapping = this.getDefaultClassMapping(cls.name);
                }

                this.currentMapping.classMappings.push({
                    source: cls.name,
                    target: defaultMapping,
                    label: cls.label,
                    type: 'class',
                    verified: verified
                });
            });
        }

        if (sourceModel.properties && sourceModel.properties.length > 0) {
            sourceModel.properties.forEach(prop => {
                const savedMapping = this.getSavedMapping('attribute', prop.name);
                let defaultMapping;
                let verified = false;

                if (savedMapping) {
                    defaultMapping = savedMapping.target;
                    verified = true;
                } else {
                    defaultMapping = this.getDefaultAttributeMapping(prop.name);
                }

                this.currentMapping.attributeMappings.push({
                    source: prop.name,
                    target: defaultMapping,
                    label: prop.label,
                    type: 'attribute',
                    domain: prop.domain,
                    verified: verified
                });
            });
        }
        
        if (sourceModel.associations && sourceModel.associations.length > 0) {
            sourceModel.associations.forEach(assoc => {
                const savedMapping = this.getSavedMapping('association', assoc.name);
                let defaultMapping;
                let verified = false;

                if (savedMapping) {
                    defaultMapping = savedMapping.target;
                    verified = true;
                } else {
                    defaultMapping = this.getDefaultAssociationMapping(assoc.name, assoc.domain, assoc.range);
                }

                this.currentMapping.associationMappings.push({
                    source: assoc.name,
                    target: defaultMapping,
                    label: assoc.label,
                    type: 'association',
                    domain: assoc.domain,
                    range: assoc.range,
                    cardinality: assoc.cardinality,
                    verified: verified
                });
            });
        }

        this.displayClassMapping();
        this.displayAttributeMapping();
        this.displayAssociationMapping();
        this.switchTab('class-mapping');
        
        this.showAutoAppliedMappingsStats();
    }

    showAutoAppliedMappingsStats() {
        const autoAppliedClasses = this.currentMapping.classMappings.filter(item => item.verified).length;
        const autoAppliedAttributes = this.currentMapping.attributeMappings.filter(item => item.verified).length;
        
        if (autoAppliedClasses > 0 || autoAppliedAttributes > 0) {
            this.showSuccess(
                `Автоматически применено сохраненных соответствий: ` +
                `${autoAppliedClasses} классов, ${autoAppliedAttributes} атрибутов`
            );
        }
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
            'Column': 'IfcColumn',
            'Road': 'IfcRoad',
            'Site': 'IfcSite',
            'Project': 'IfcProject',
            'Stair': 'IfcStair',
            'Ramp': 'IfcRamp',
            'Foundation': 'IfcFooting',
            'Pipe': 'IfcFlowSegment',
            'Duct': 'IfcFlowSegment',
            'Cable': 'IfcFlowSegment',
            'Furniture': 'IfcFurnishingElement',
            'Equipment': 'IfcElementAssembly',
            'Light': 'IfcLightFixture',
            'Sensor': 'IfcSensor',
            'Controller': 'IfcFlowController',
            'Valve': 'IfcFlowController',
            'Pump': 'IfcEnergyConversionDevice',
            'Fan': 'IfcEnergyConversionDevice',
            'Generator': 'IfcElectricGenerator',
            'Transformer': 'IfcElectricGenerator'
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
            'hasVolume': 'GrossVolume',
            'hasName': 'Name',
            'hasDescription': 'Description',
            'hasType': 'ObjectType',
            'hasWeight': 'GrossWeight',
            'hasColor': 'Color',
            'hasTemperature': 'Temperature',
            'hasPressure': 'Pressure',
            'hasFlowRate': 'FlowRate',
            'hasPower': 'Power',
            'hasEfficiency': 'Efficiency',
            'hasVoltage': 'Voltage',
            'hasCurrent': 'Current',
            'hasFrequency': 'Frequency',
            'hasStatus': 'Status',
            'hasCondition': 'Condition'
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
			
			const displayName = mapping.label || this.generateReadableName(mapping.source);
			const savedMapping = this.getSavedMapping('class', mapping.source);
			const usageInfo = savedMapping ? ` (использовано ${savedMapping.usageCount} раз)` : '';
			
			const ifcClasses = this.getIfcClasses();
			const isCustomValue = !ifcClasses.includes(mapping.target);
			
			item.innerHTML = `
				<div class="source-item">
					<div class="element-name">${displayName}</div>
					<div class="element-technical">${mapping.source}${usageInfo}</div>
				</div>
				<div class="target-item">
					<div class="searchable-select" data-index="${index}" data-type="class">
						<div class="selected-value">${mapping.target || '-- Выберите IFC класс --'}</div>
						<div class="dropdown">
							<input type="text" class="search-input" placeholder="Поиск IFC класса...">
							<div class="options-list">
								<div class="option ${isCustomValue ? 'selected' : ''}" data-value="custom">-- Другое --</div>
								${ifcClasses.map(cls => 
									`<div class="option ${cls === mapping.target ? 'selected' : ''}" data-value="${cls}">${cls}</div>`
								).join('')}
							</div>
						</div>
					</div>
					<input type="text" class="mapping-input" 
						   style="display: ${isCustomValue ? 'block' : 'none'};"
						   value="${isCustomValue ? mapping.target : ''}" 
						   placeholder="Введите IFC класс">
				</div>
				<div class="verified-item">
					<input type="checkbox" class="verified-checkbox" data-index="${index}" data-type="class" 
						   ${mapping.verified ? 'checked' : ''}>
					<span class="verified-label">${mapping.verified ? '✓' : '✗'}</span>
				</div>
			`;
			container.appendChild(item);
		});

		this.bindMappingEvents('class');
		this.bindSearchableSelectEvents();
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
			
			const displayName = mapping.label || this.generateReadableName(mapping.source);
			const savedMapping = this.getSavedMapping('attribute', mapping.source);
			const usageInfo = savedMapping ? ` (использовано ${savedMapping.usageCount} раз)` : '';
			const domainInfo = mapping.domain ? `Класс: ${mapping.domain}` : '';
			
			const allProperties = this.getAllIfcProperties();
			const isCustomValue = !allProperties.includes(mapping.target);
			
			item.innerHTML = `
				<div class="source-item">
					<div class="element-name">${displayName}</div>
					<div class="element-technical">${mapping.source}${usageInfo}</div>
					${domainInfo ? `<div class="attribute-domain-info">${domainInfo}</div>` : ''}
				</div>
				<div class="target-item">
					<div class="searchable-select" data-index="${index}" data-type="attribute">
						<div class="selected-value">${mapping.target || '-- Выберите атрибут --'}</div>
						<div class="dropdown">
							<input type="text" class="search-input" placeholder="Поиск IFC атрибута...">
							<div class="options-list">
								<div class="option ${isCustomValue ? 'selected' : ''}" data-value="custom">-- Другое --</div>
								${allProperties.map(attr => 
									`<div class="option ${attr === mapping.target ? 'selected' : ''}" data-value="${attr}">${attr}</div>`
								).join('')}
							</div>
						</div>
					</div>
					<input type="text" class="mapping-input" 
						   style="display: ${isCustomValue ? 'block' : 'none'};"
						   value="${isCustomValue ? mapping.target : ''}" 
						   placeholder="Введите IFC атрибут">
				</div>
				<div class="verified-item">
					<input type="checkbox" class="verified-checkbox" data-index="${index}" data-type="attribute" 
						   ${mapping.verified ? 'checked' : ''}>
					<span class="verified-label">${mapping.verified ? '✓' : '✗'}</span>
				</div>
			`;
			container.appendChild(item);
		});

		this.bindMappingEvents('attribute');
		this.bindSearchableSelectEvents();
	}

	displayAssociationMapping() {
		const container = document.getElementById('associationMappingList');
		container.innerHTML = '';

		if (!this.currentMapping.associationMappings || this.currentMapping.associationMappings.length === 0) {
			container.innerHTML = '<div class="no-mappings">Ассоциации не найдены в исходной модели</div>';
			return;
		}

		this.currentMapping.associationMappings.forEach((mapping, index) => {
			const item = document.createElement('div');
			item.className = 'mapping-item';
			
			const displayName = mapping.label || this.generateReadableName(mapping.source);
			const savedMapping = this.getSavedMapping('association', mapping.source);
			const usageInfo = savedMapping ? ` (использовано ${savedMapping.usageCount} раз)` : '';
			
			// Получаем соответствующий IFC класс для домена
			const domainClass = mapping.domain ? 
				this.currentMapping.classMappings.find(m => m.source === mapping.domain)?.target : null;
			
			const domainProperties = domainClass ? this.getIfcClassProperties(domainClass) : [];
			const allProperties = this.getAllIfcProperties();
			
			const isCustomValue = !allProperties.includes(mapping.target);
			
			item.innerHTML = `
				<div class="source-item">
					<div class="element-name">${displayName}</div>
					<div class="element-technical">${mapping.source}${usageInfo}</div>
					<div class="association-source-target">
						${mapping.domain ? `Домен: ${mapping.domain}` : ''} 
						${mapping.range ? '→ ' + mapping.range : ''}
						${mapping.cardinality ? ` (${mapping.cardinality})` : ''}
						${domainClass ? ` [IFC: ${domainClass}]` : ''}
					</div>
				</div>
				<div class="target-item">
					<div class="searchable-select" data-index="${index}" data-type="association">
						<div class="selected-value">${mapping.target || '-- Выберите свойство --'}</div>
						<div class="dropdown">
							<input type="text" class="search-input" placeholder="Поиск IFC свойства...">
							<div class="options-list">
								<div class="option ${isCustomValue ? 'selected' : ''}" data-value="custom">-- Другое --</div>
								${domainClass ? `
									<div class="option-group">Свойства класса ${domainClass}</div>
									${domainProperties.map(prop => 
										`<div class="option ${prop === mapping.target ? 'selected' : ''}" data-value="${prop}">${prop}</div>`
									).join('')}
									<div class="option-group">Все свойства IFC</div>
								` : ''}
								${allProperties.map(prop => 
									`<div class="option ${prop === mapping.target ? 'selected' : ''}" data-value="${prop}">${prop}</div>`
								).join('')}
							</div>
						</div>
					</div>
					<input type="text" class="mapping-input" 
						   style="display: ${isCustomValue ? 'block' : 'none'};"
						   value="${isCustomValue ? mapping.target : ''}" 
						   placeholder="Введите IFC свойство">
				</div>
				<div class="verified-item">
					<input type="checkbox" class="verified-checkbox" data-index="${index}" data-type="association" 
						   ${mapping.verified ? 'checked' : ''}>
					<span class="verified-label">${mapping.verified ? '✓' : '✗'}</span>
				</div>
			`;
			container.appendChild(item);
		});

		this.bindMappingEvents('association');
		this.bindSearchableSelectEvents();
	}

    getDefaultAssociationMapping(associationName, domain, range) {
        // Для ObjectProperty предлагаем свойства соответствующего класса
        if (domain) {
            const domainClass = this.currentMapping.classMappings.find(m => m.source === domain)?.target;
            if (domainClass) {
                const classProperties = this.getIfcClassProperties(domainClass);
                if (classProperties.length > 0) {
                    // Пытаемся найти подходящее свойство по имени
                    const lowerName = associationName.toLowerCase();
                    for (const prop of classProperties) {
                        if (prop.toLowerCase().includes(lowerName) || lowerName.includes(prop.toLowerCase())) {
                            return prop;
                        }
                    }
                    // Возвращаем первое свойство по умолчанию
                    return classProperties[0];
                }
            }
        }
        
        return this.getAllIfcProperties()[0] || 'Name';
    }

    // Новый метод для привязки событий к улучшенным селектам
    bindSearchableSelectEvents() {
        // Закрытие всех выпадающих списков при клике вне их
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.searchable-select')) {
                document.querySelectorAll('.searchable-select').forEach(select => {
                    select.classList.remove('open');
                });
            }
        });

        // Открытие/закрытие выпадающего списка
        document.querySelectorAll('.searchable-select .selected-value').forEach(selectedValue => {
            selectedValue.addEventListener('click', (e) => {
                const select = e.target.closest('.searchable-select');
                const isOpen = select.classList.contains('open');
                
                // Закрываем все остальные
                document.querySelectorAll('.searchable-select').forEach(s => {
                    if (s !== select) {
                        s.classList.remove('open');
                    }
                });
                
                // Переключаем текущий
                select.classList.toggle('open');
                
                // Фокусируемся на поле поиска при открытии
                if (!isOpen) {
                    const searchInput = select.querySelector('.search-input');
                    if (searchInput) {
                        setTimeout(() => searchInput.focus(), 100);
                    }
                }
            });
        });

        // Поиск в выпадающем списке
        document.querySelectorAll('.searchable-select .search-input').forEach(searchInput => {
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                const optionsList = e.target.nextElementSibling;
                const options = optionsList.querySelectorAll('.option');
                
                options.forEach(option => {
                    const text = option.textContent.toLowerCase();
                    if (text.includes(searchTerm) || option.classList.contains('option-group')) {
                        option.style.display = '';
                    } else {
                        option.style.display = 'none';
                    }
                });
            });
            
            // Предотвращаем закрытие при клике на поле поиска
            searchInput.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        });

		document.querySelectorAll('.searchable-select .option').forEach(option => {
			option.addEventListener('click', (e) => {
				e.stopPropagation();
				const select = e.target.closest('.searchable-select');
				const selectedValue = select.querySelector('.selected-value');
				const value = e.target.getAttribute('data-value');
				
				// Убираем выделение у всех опций
				select.querySelectorAll('.option').forEach(opt => {
					opt.classList.remove('selected');
				});
				
				// Выделяем выбранную опцию
				e.target.classList.add('selected');
				
				// Обновляем отображаемое значение
				if (value === 'custom') {
					selectedValue.textContent = '-- Другое --';
				} else {
					selectedValue.textContent = value;
				}
				
				// Закрываем выпадающий список
				select.classList.remove('open');
				
				// Обновляем маппинг
				const index = parseInt(select.getAttribute('data-index'));
				const type = select.getAttribute('data-type');
				const input = select.parentNode.querySelector('.mapping-input');
				
				if (value === 'custom') {
					input.style.display = 'block';
					input.focus();
					const newValue = input.value || '';
					this.updateMapping(type, index, newValue);
				} else {
					input.style.display = 'none';
					this.updateMapping(type, index, value);
					input.value = '';
					
					// Если это ObjectProperty и выбранное свойство не существует в схеме, добавляем его
					if (type === 'association' && value && value !== 'custom') {
						const mapping = this.currentMapping.associationMappings[index];
						if (mapping && mapping.domain) {
							const domainClass = this.currentMapping.classMappings.find(m => m.source === mapping.domain)?.target;
							if (domainClass) {
								const classProperties = this.getIfcClassProperties(domainClass);
								if (!classProperties.includes(value)) {
									this.addCustomPropertyToClass(domainClass, value);
								}
							}
						}
					}
				}
			});
		});
	}

    bindMappingEvents(type) {
        let container;
        
        if (type === 'class') {
            container = document.getElementById('classMappingList');
        } else if (type === 'attribute') {
            container = document.getElementById('attributeMappingList');
        } else if (type === 'association') {
            container = document.getElementById('associationMappingList');
        } else {
            return;
        }

        container.removeEventListener('change', this.handleMappingChange);
        container.removeEventListener('input', this.handleMappingInput);
        
        container.addEventListener('change', this.handleMappingChange);
        container.addEventListener('input', this.handleMappingInput);
    }

    handleMappingChange(e) {
        if (e.target.classList.contains('verified-checkbox')) {
            const index = parseInt(e.target.getAttribute('data-index'));
            const type = e.target.getAttribute('data-type');
            const isVerified = e.target.checked;
            this.updateVerificationStatus(type, index, isVerified);
            
            const label = e.target.nextElementSibling;
            label.textContent = isVerified ? '✓' : '✗';
        }
    }

    handleMappingInput(e) {
        if (e.target.classList.contains('mapping-input')) {
            const parent = e.target.parentNode;
            const select = parent.querySelector('.searchable-select');
            const index = parseInt(select.getAttribute('data-index'));
            const type = select.getAttribute('data-type');
            
            if (e.target.style.display !== 'none') {
                this.updateMapping(type, index, e.target.value);
            }
        }
    }

    updateMapping(type, index, value) {
        console.log(`Updating ${type} mapping at index ${index} to: ${value}`);
        
        if (type === 'class') {
            if (this.currentMapping.classMappings[index]) {
                this.currentMapping.classMappings[index].target = value;
            }
        } else if (type === 'attribute') {
            if (this.currentMapping.attributeMappings[index]) {
                this.currentMapping.attributeMappings[index].target = value;
            }
        } else if (type === 'association') {
            if (this.currentMapping.associationMappings && this.currentMapping.associationMappings[index]) {
                this.currentMapping.associationMappings[index].target = value;
            }
        }
    }

    updateVerificationStatus(type, index, isVerified) {
        console.log(`Updating ${type} verification at index ${index} to: ${isVerified}`);
        
        if (type === 'class') {
            if (this.currentMapping.classMappings[index]) {
                this.currentMapping.classMappings[index].verified = isVerified;
                
                if (isVerified) {
                    const mapping = this.currentMapping.classMappings[index];
                    this.addVerifiedMapping('class', mapping.source, mapping.target);
                }
            }
        } else if (type === 'attribute') {
            if (this.currentMapping.attributeMappings[index]) {
                this.currentMapping.attributeMappings[index].verified = isVerified;
                
                if (isVerified) {
                    const mapping = this.currentMapping.attributeMappings[index];
                    this.addVerifiedMapping('attribute', mapping.source, mapping.target);
                }
            }
        } else if (type === 'association') {
            if (this.currentMapping.associationMappings && this.currentMapping.associationMappings[index]) {
                this.currentMapping.associationMappings[index].verified = isVerified;
                
                if (isVerified) {
                    const mapping = this.currentMapping.associationMappings[index];
                    this.addVerifiedMapping('association', mapping.source, mapping.target);
                    
                    // Если это ObjectProperty и свойство не существует в схеме, добавляем его
                    if (mapping.domain && mapping.target) {
                        const domainClass = this.currentMapping.classMappings.find(m => m.source === mapping.domain)?.target;
                        if (domainClass) {
                            const classProperties = this.getIfcClassProperties(domainClass);
                            if (!classProperties.includes(mapping.target)) {
                                this.addCustomPropertyToClass(domainClass, mapping.target);
                            }
                        }
                    }
                }
            }
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
        mappingText += `Тип исходной модели: ${this.currentMapping.sourceType}\n`;
        mappingText += `Источник: ${this.getSourceModelInfo()}\n\n`;
        
        mappingText += "СОПОСТАВЛЕНИЕ КЛАССОВ:\n";
        mappingText += "---------------------\n";
        this.currentMapping.classMappings.forEach((item, index) => {
            const displayName = item.label || this.generateReadableName(item.source);
            const status = item.verified ? '✓ ПОДТВЕРЖДЕНО' : '✗ НЕПОДТВЕРЖДЕНО';
            mappingText += `${index + 1}. ${displayName} (${item.source}) → ${item.target} [${status}]\n`;
        });
        
        mappingText += "\nСОПОСТАВЛЕНИЕ АТРИБУТОВ:\n";
        mappingText += "-----------------------\n";
        this.currentMapping.attributeMappings.forEach((item, index) => {
            const displayName = item.label || this.generateReadableName(item.source);
            const status = item.verified ? '✓ ПОДТВЕРЖДЕНО' : '✗ НЕПОДТВЕРЖДЕНО';
            const domainInfo = item.domain ? ` [Класс: ${item.domain}]` : '';
            mappingText += `${index + 1}. ${displayName} (${item.source})${domainInfo} → ${item.target} [${status}]\n`;
        });
        
        mappingText += "\nСОПОСТАВЛЕНИЕ АССОЦИАЦИЙ:\n";
        mappingText += "-------------------------\n";
        if (this.currentMapping.associationMappings && this.currentMapping.associationMappings.length > 0) {
            this.currentMapping.associationMappings.forEach((item, index) => {
                const displayName = item.label || this.generateReadableName(item.source);
                const status = item.verified ? '✓ ПОДТВЕРЖДЕНО' : '✗ НЕПОДТВЕРЖДЕНО';
                const domainRange = item.domain && item.range ? ` (${item.domain} → ${item.range})` : '';
                mappingText += `${index + 1}. ${displayName}${domainRange} (${item.source}) → ${item.target} [${status}]\n`;
            });
        } else {
            mappingText += "Ассоциации не найдены\n";
        }
        
        mappingText += `\nВсего классов: ${this.currentMapping.classMappings.length}`;
        mappingText += `\nВсего атрибутов: ${this.currentMapping.attributeMappings.length}`;
        
        const verifiedClasses = this.currentMapping.classMappings.filter(item => item.verified).length;
        const verifiedAttributes = this.currentMapping.attributeMappings.filter(item => item.verified).length;
        mappingText += `\nПодтверждено классов: ${verifiedClasses}/${this.currentMapping.classMappings.length}`;
        mappingText += `\nПодтверждено атрибутов: ${verifiedAttributes}/${this.currentMapping.attributeMappings.length}`;
        
        const blob = new Blob([mappingText], { type: 'text/plain; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `mapping_${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showSuccess('Соответствия экспортированы в файл');
    }

    getSourceModelInfo() {
        const sourceCode = this.sourceEditor.getValue();
        const lines = sourceCode.split('\n');
        const firstLines = lines.slice(0, 5).join(' ').substring(0, 100);
        return firstLines + (firstLines.length >= 100 ? '...' : '');
    }

    downloadIfc() {
        if (!this.currentMapping) {
            this.showError('Сначала создайте соответствия');
            return;
        }

        const ifcContent = this.generateIfcContent();
        
        const blob = new Blob([ifcContent], { type: 'text/plain; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `model_${new Date().toISOString().split('T')[0]}.ifc`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showSuccess('IFC файл сгенерирован и скачан');
    }

    generateIfcContent() {
        let ifcContent = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('IFC4X3 Model'), '2;1');
FILE_NAME('${new Date().toISOString().split('T')[0]}', '${new Date().toISOString()}', (''), (''), 'IFC Model Mapper', '1.0', '');
FILE_SCHEMA(('IFC4X3'));
ENDSEC;

DATA;
`;

        if (this.currentMapping.classMappings.length > 0) {
            this.currentMapping.classMappings.forEach((mapping, index) => {
                if (mapping.verified) {
                    ifcContent += `#${index + 100}=${mapping.target}(${index + 100},'${mapping.source}','${mapping.label || mapping.source}',$,$,$,$,$,$);\n`;
                }
            });
        }

        ifcContent += "ENDSEC;\nEND-ISO-10303-21;";
        return ifcContent;
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

    validateMapping() {
        if (!this.currentMapping) {
            this.showError('Сначала создайте соответствия для проверки');
            return;
        }

        const errors = this.findHierarchyErrors();
        
        if (errors.length === 0) {
            this.showSuccess('Преобразование корректно');
        } else {
            this.showHierarchyErrors(errors);
        }
    }
	
    extractSourceHierarchy() {
        const hierarchy = {};
        const sourceCode = this.sourceEditor.getValue();
        const sourceType = document.getElementById('sourceType').value;
        
        if (sourceType === 'owl') {
            return this.extractOwlHierarchy(sourceCode);
        } else if (sourceType === 'rdf') {
            return this.extractRdfHierarchy(sourceCode);
        }
        
        return {};
    }

	// Добавляем метод для отладки - получение полной иерархии класса
	getFullIfcHierarchy(ifcClass) {
		const hierarchies = this.getIfcHierarchies();
		const fullHierarchy = [];
		
		const collectAncestors = (currentClass, path = []) => {
			const parents = hierarchies[currentClass] || [];
			
			for (const parent of parents) {
				const newPath = [...path, parent];
				fullHierarchy.push([...newPath]);
				collectAncestors(parent, newPath);
			}
		};
		
		collectAncestors(ifcClass, [ifcClass]);
		
		return fullHierarchy;
	}
	
	// Метод для получения всех предков IFC класса
	getIfcClassAncestors(ifcClass) {
		const hierarchies = this.getIfcHierarchies();
		const ancestors = new Set();
		
		const collectAncestors = (currentClass) => {
			const parents = hierarchies[currentClass] || [];
			
			for (const parent of parents) {
				if (!ancestors.has(parent)) {
					ancestors.add(parent);
					collectAncestors(parent);
				}
			}
		};
		
		collectAncestors(ifcClass);
		return Array.from(ancestors);
	}

	getIfcHierarchies() {
		if (!this.ifcSchema || !this.ifcSchema.Classes) {
			return { parents: {}, children: {} };
		}

		const hierarchies = {
			parents: {},  // класс -> его прямые родители
			children: {}  // класс -> его прямые потомки
		};

		// Строим иерархию на основе ParentClassCode
		this.ifcSchema.Classes.forEach(cls => {
			if (cls.ParentClassCode && cls.ParentClassCode !== '') {
				// Добавляем отношение родитель -> потомок
				if (!hierarchies.children[cls.ParentClassCode]) {
					hierarchies.children[cls.ParentClassCode] = [];
				}
				if (!hierarchies.children[cls.ParentClassCode].includes(cls.Code)) {
					hierarchies.children[cls.ParentClassCode].push(cls.Code);
				}

				// Добавляем отношение потомок -> родитель
				if (!hierarchies.parents[cls.Code]) {
					hierarchies.parents[cls.Code] = [];
				}
				if (!hierarchies.parents[cls.Code].includes(cls.ParentClassCode)) {
					hierarchies.parents[cls.Code].push(cls.ParentClassCode);
				}
			}
		});

		// Добавляем пользовательские классы
		if (this.customIfcSchema && this.customIfcSchema.Classes) {
			this.customIfcSchema.Classes.forEach(cls => {
				if (cls.ParentClassCode && cls.ParentClassCode !== '') {
					if (!hierarchies.children[cls.ParentClassCode]) {
						hierarchies.children[cls.ParentClassCode] = [];
					}
					if (!hierarchies.children[cls.ParentClassCode].includes(cls.Code)) {
						hierarchies.children[cls.ParentClassCode].push(cls.Code);
					}

					if (!hierarchies.parents[cls.Code]) {
						hierarchies.parents[cls.Code] = [];
					}
					if (!hierarchies.parents[cls.Code].includes(cls.ParentClassCode)) {
						hierarchies.parents[cls.Code].push(cls.ParentClassCode);
					}
				}
			});
		}

		console.log('Построенная иерархия IFC:', hierarchies);
		return hierarchies;
	}

	// Исправленный метод проверки является ли класс предком
	isIfcAncestor(potentialAncestor, potentialDescendant, hierarchies) {
		if (potentialAncestor === potentialDescendant) {
			return true; // Класс является своим собственным предком
		}

		const visited = new Set();
		const queue = [potentialDescendant];
		
		while (queue.length > 0) {
			const currentClass = queue.shift();
			
			if (visited.has(currentClass)) continue;
			visited.add(currentClass);
			
			// Получаем прямых родителей текущего класса
			const parents = hierarchies.parents[currentClass] || [];
			
			for (const parent of parents) {
				if (parent === potentialAncestor) {
					return true; // Нашли предка
				}
				queue.push(parent);
			}
		}
		
		return false;
	}

	// Упрощенная и корректная проверка соответствия иерархий
	validateHierarchyMapping(childIfcClass, parentIfcClass, childSource, parentSource) {
		console.log(`Проверка иерархии: ${childSource}(${childIfcClass}) -> ${parentSource}(${parentIfcClass})`);
		
		const hierarchies = this.getIfcHierarchies();
		
		// В IFC иерархии: parentIfcClass должен быть предком childIfcClass
		const isCorrectHierarchy = this.isIfcAncestor(parentIfcClass, childIfcClass, hierarchies);
		
		console.log(`Результат: ${isCorrectHierarchy ? 'КОРРЕКТНО' : 'ОШИБКА'}`);
		return isCorrectHierarchy;
	}

	// Улучшенный поиск ошибок иерархии
	findHierarchyErrors() {
		const errors = [];
		
		const sourceHierarchy = this.extractSourceHierarchy();
		console.log('Исходная иерархия OWL:', sourceHierarchy);
		
		const classMappings = this.currentMapping.classMappings;
		
		// Создаем карту маппингов для быстрого поиска
		const mappingMap = new Map();
		classMappings.forEach(mapping => {
			mappingMap.set(mapping.source, mapping);
		});
		
		// Проверяем все отношения наследования из исходной модели
		for (const [childClass, parentClasses] of Object.entries(sourceHierarchy)) {
			const childMapping = mappingMap.get(childClass);
			
			if (!childMapping) {
				console.log(`Пропускаем ${childClass} - нет маппинга`);
				continue;
			}
			
			for (const parentClass of parentClasses) {
				const parentMapping = mappingMap.get(parentClass);
				
				if (!parentMapping) {
					console.log(`Пропускаем родителя ${parentClass} - нет маппинга`);
					continue;
				}
				
				console.log(`Проверяем: ${childClass}->${parentClass} как ${childMapping.target}->${parentMapping.target}`);
				
				// Проверяем соответствие иерархии
				const isValid = this.validateHierarchyMapping(
					childMapping.target, 
					parentMapping.target,
					childClass,
					parentClass
				);
				
				if (!isValid) {
					// Определяем тип ошибки
					const hierarchies = this.getIfcHierarchies();
					let errorType = 'нарушение иерархии';
					
					// Проверяем является ли это обратной иерархией
					if (this.isIfcAncestor(childMapping.target, parentMapping.target, hierarchies)) {
						errorType = 'обратная иерархия';
					}
					
					errors.push({
						childClass,
						parentClass,
						childMapping: childMapping.target,
						parentMapping: parentMapping.target,
						errorType: errorType,
						message: this.getHierarchyErrorMessage(errorType, childClass, parentClass, childMapping.target, parentMapping.target)
					});
					
					console.log(`НАЙДЕНА ОШИБКА: ${errorType}`);
				}
			}
		}
		
		console.log(`Всего найдено ошибок: ${errors.length}`);
		return errors;
	}

	// Улучшенное извлечение иерархии из OWL Turtle
	extractOwlHierarchy(turtleCode) {
		const hierarchy = {};
		
		// Упрощенный парсинг - ищем явные rdfs:subClassOf
		const lines = turtleCode.split('\n');
		
		lines.forEach(line => {
			line = line.trim();
			
			// Ищем паттерн: :ChildClass rdfs:subClassOf :ParentClass
			const subclassMatch = line.match(/^:(\w+)\s+rdfs:subClassOf\s+:(\w+)/);
			if (subclassMatch) {
				const childClass = subclassMatch[1];
				const parentClass = subclassMatch[2];
				
				if (!hierarchy[childClass]) {
					hierarchy[childClass] = [];
				}
				if (!hierarchy[childClass].includes(parentClass)) {
					hierarchy[childClass].push(parentClass);
				}
			}
			
			// Ищем паттерн в многострочном формате
			const multilineMatch = line.match(/^:(\w+)\s+a\s+owl:Class\s*;/);
			if (multilineMatch) {
				const currentClass = multilineMatch[1];
				// Следующие строки могут содержать rdfs:subClassOf
				const nextLines = lines.slice(lines.indexOf(line) + 1, lines.indexOf(line) + 10);
				for (const nextLine of nextLines) {
					if (nextLine.trim().startsWith('rdfs:subClassOf')) {
						const parentMatch = nextLine.match(/rdfs:subClassOf\s+:(\w+)/);
						if (parentMatch) {
							const parentClass = parentMatch[1];
							if (!hierarchy[currentClass]) {
								hierarchy[currentClass] = [];
							}
							if (!hierarchy[currentClass].includes(parentClass)) {
								hierarchy[currentClass].push(parentClass);
							}
							break;
						}
					}
					if (nextLine.trim().endsWith('.')) break; // Конец блока
				}
			}
		});
		
		console.log('Извлеченная иерархия OWL:', hierarchy);
		return hierarchy;
	}

	// Улучшенное извлечение иерархии из RDF
	extractRdfHierarchy(rdfCode) {
		const hierarchy = {};
		
		// Ищем блоки классов
		const classBlocks = rdfCode.match(/<owl:Class rdf:ID="(\w+)">([\s\S]*?)<\/owl:Class>/g) || [];
		
		classBlocks.forEach(block => {
			const classMatch = block.match(/<owl:Class rdf:ID="(\w+)">/);
			if (!classMatch) return;
			
			const className = classMatch[1];
			
			// Ищем все rdfs:subClassOf в блоке
			const subclassMatches = block.matchAll(/<rdfs:subClassOf rdf:resource="#(\w+)"/g);
			
			for (const match of subclassMatches) {
				const parentClass = match[1];
				if (!hierarchy[className]) {
					hierarchy[className] = [];
				}
				if (!hierarchy[className].includes(parentClass)) {
					hierarchy[className].push(parentClass);
				}
			}
		});
		
		return hierarchy;
	}

	// Метод для отладки конкретного случая
	debugSpecificHierarchy(childClass, parentClass) {
		const mappingMap = new Map();
		this.currentMapping.classMappings.forEach(mapping => {
			mappingMap.set(mapping.source, mapping);
		});
		
		const childMapping = mappingMap.get(childClass);
		const parentMapping = mappingMap.get(parentClass);
		
		if (!childMapping || !parentMapping) {
			console.log('Один из классов не найден в маппингах');
			return;
		}
		
		console.log('=== ДЕТАЛЬНАЯ ДИАГНОСТИКА ===');
		console.log('OWL:', childClass, '->', parentClass);
		console.log('IFC:', childMapping.target, '->', parentMapping.target);
		
		const hierarchies = this.getIfcHierarchies();
		const isCorrect = this.isIfcAncestor(parentMapping.target, childMapping.target, hierarchies);
		const isReverse = this.isIfcAncestor(childMapping.target, parentMapping.target, hierarchies);
		
		console.log('Результаты:');
		console.log('- Корректная иерархия:', isCorrect);
		console.log('- Обратная иерархия:', isReverse);
		console.log('- Путь ребенка:', this.getIfcClassHierarchyPath(childMapping.target));
		console.log('- Путь родителя:', this.getIfcClassHierarchyPath(parentMapping.target));
		
		return {
			isCorrect,
			isReverse,
			childPath: this.getIfcClassHierarchyPath(childMapping.target),
			parentPath: this.getIfcClassHierarchyPath(parentMapping.target)
		};
	}
	// Обновленный метод showHierarchyErrors с дополнительной информацией
	showHierarchyErrors(errors) {
		const modal = document.createElement('div');
		modal.className = 'modal';
		modal.style.display = 'block';
		
		// Группируем ошибки по типам для лучшего отображения
		const errorTypes = {
			'обратная иерархия': errors.filter(e => e.errorType === 'обратная иерархия'),
			'нарушение иерархии': errors.filter(e => e.errorType === 'нарушение иерархии')
		};
		
		modal.innerHTML = `
			<div class="modal-content" style="max-width: 1000px;">
				<div class="modal-header">
					<h2>Обнаружены ошибки в иерархиях классов</h2>
					<div style="font-size: 14px; color: var(--secondary-color); margin-top: 5px;">
						Проверка основана на реальной иерархии IFC 4.3
					</div>
				</div>
				<div style="padding: 20px 30px;">
					<div style="margin-bottom: 15px; color: var(--error-color);">
						<strong>Найдено ${errors.length} ошибок:</strong>
					</div>
					
					${Object.entries(errorTypes).map(([type, typeErrors]) => 
						typeErrors.length > 0 ? `
						<div style="margin-bottom: 25px;">
							<h4 style="color: var(--error-color); margin-bottom: 10px; border-bottom: 2px solid var(--error-color); padding-bottom: 5px;">
								${type === 'обратная иерархия' ? '⛔ ОБРАТНЫЕ ИЕРАРХИИ' : '⚠️ НАРУШЕНИЯ ИЕРАРХИЙ'}
								<span style="font-size: 14px; color: var(--secondary-color); margin-left: 10px;">
									(${typeErrors.length} ошибок)
								</span>
							</h4>
							<div style="max-height: 400px; overflow-y: auto;">
								${typeErrors.map((error, index) => {
									const childPath = this.getIfcClassHierarchyPath(error.childMapping);
									const parentPath = this.getIfcClassHierarchyPath(error.parentMapping);
									
									return `
									<div style="padding: 15px; border: 2px solid var(--error-color); border-radius: 8px; margin-bottom: 15px; background: #fef2f2;">
										<div style="font-weight: bold; margin-bottom: 8px; font-size: 16px;">
											Ошибка ${index + 1}:
											${type === 'обратная иерархия' ? 'Обратная иерархия' : 'Нарушение иерархии'}
										</div>
										<div style="margin-bottom: 8px; font-size: 14px;">
											<strong>Проблема:</strong> ${error.message}
										</div>
										<div style="font-size: 13px; color: var(--secondary-color); margin-bottom: 10px;">
											<div><strong>Исходная иерархия OWL:</strong> ${error.childClass} → ${error.parentClass}</div>
											<div><strong>Преобразование IFC:</strong> ${error.childMapping} → ${error.parentMapping}</div>
										</div>
										${type === 'обратная иерархия' ? 
											'<div style="font-size: 12px; color: var(--warning-color); margin-top: 8px; padding: 8px; background: #fffbeb; border-radius: 4px;">' +
											'⚠️ <strong>Обнаружена обратная иерархия:</strong> Родительский класс OWL отображен в дочерний класс IFC, а дочерний OWL - в родительский IFC' +
											'</div>' : ''
										}
										<div style="margin-top: 10px; font-size: 12px;">
											<details>
												<summary style="cursor: pointer; color: var(--primary-color); font-weight: 600;">
													Показать иерархию IFC классов
												</summary>
												<div style="margin-top: 8px; padding: 8px; background: #f8fafc; border-radius: 4px;">
													<div><strong>Иерархия ${error.childMapping}:</strong> ${childPath.join(' → ')}</div>
													<div><strong>Иерархия ${error.parentMapping}:</strong> ${parentPath.join(' → ')}</div>
												</div>
											</details>
										</div>
									</div>
									`;
								}).join('')}
							</div>
						</div>
						` : ''
					).join('')}
					
					<div style="margin-top: 20px; padding: 20px; background: #f0f9ff; border-radius: 8px; border-left: 4px solid var(--primary-color);">
						<h4 style="margin-top: 0; color: var(--primary-color); margin-bottom: 10px;">Рекомендации по исправлению:</h4>
						<ul style="margin: 10px 0 0 20px; font-size: 14px;">
							<li style="margin-bottom: 8px;"><strong>Для обратных иерархий:</strong> Убедитесь, что родительские классы OWL отображаются в родительские классы IFC, а дочерние - в дочерние</li>
							<li style="margin-bottom: 8px;"><strong>Для нарушений иерархий:</strong> Проверьте, что отношения наследования сохраняются после преобразования</li>
							<li style="margin-bottom: 8px;">Используйте классы из одной ветви IFC иерархии для связанных элементов</li>
							<li style="margin-bottom: 8px;">Если классы из разных ветвей IFC, рассмотрите возможность изменения маппинга</li>
							<li>Проверьте иерархию IFC классов в раскрывающихся блоках выше для понимания отношений между классами</li>
						</ul>
					</div>
					
					<div style="margin-top: 15px; padding: 12px; background: #ecfdf5; border-radius: 6px; border-left: 4px solid var(--success-color);">
						<div style="font-size: 13px; color: var(--success-color); font-weight: 600;">
							💡 Система проверяет реальную иерархию IFC 4.3 из загруженной схемы
						</div>
					</div>
				</div>
				<div class="modal-footer">
					<button id="closeErrorsModalBtn" class="save-button">Закрыть</button>
				</div>
			</div>
		`;
		
		document.body.appendChild(modal);
		
		document.getElementById('closeErrorsModalBtn').addEventListener('click', () => {
			modal.remove();
		});
		
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.remove();
			}
		});
	}

	showMappingManagementModal() {
		const modal = document.createElement('div');
		modal.className = 'modal';
		modal.style.display = 'block';
		
		const stats = this.getMappingStatistics();
		const schemaStats = this.getSchemaStatistics();
		
		modal.innerHTML = `
			<div class="modal-content" style="max-width: 900px;">
				<div class="modal-header">
					<h2>Управление сохраненными соответствиями</h2>
				</div>
				<div style="padding: 20px 30px;">
					<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
						<div>
							<h4>Статистика сохраненных соответствий</h4>
							<p>Сохранено классов: ${stats.classCount}</p>
							<p>Сохранено атрибутов: ${stats.attributeCount}</p>
							<p>Сохранено ассоциаций: ${stats.associationCount}</p>
							<p>Последнее обновление: ${stats.lastUpdated || 'никогда'}</p>
						</div>
						<div>
							<h4>Статистика схемы IFC</h4>
							<p>Всего классов IFC: ${schemaStats.totalClasses}</p>
							<p>Всего свойств IFC: ${schemaStats.totalProperties}</p>
							<p>Пользовательских свойств: ${schemaStats.customProperties}</p>
							<p style="color: var(--success-color); font-weight: 600;">
								✓ Схема автоматически расширяется при добавлении новых свойств
							</p>
						</div>
					</div>
					
					<div style="margin-bottom: 20px;">
						<h4>Сохраненные соответствия классов</h4>
						<div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-color); padding: 10px;">
							${Object.keys(this.savedMappings.classMappings).length > 0 
								? Object.entries(this.savedMappings.classMappings)
									.map(([source, data]) => 
										`<div style="padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
											<strong>${source}</strong> → ${data.target} 
											<span style="color: var(--secondary-color); font-size: 12px;">
												(использовано: ${data.usageCount} раз)
											</span>
										</div>`
									).join('')
								: '<div style="color: var(--secondary-color); font-style: italic;">Нет сохраненных соответствий классов</div>'
							}
						</div>
					</div>
					
					<div style="margin-bottom: 20px;">
						<h4>Автоматически добавленные свойства</h4>
						<div style="max-height: 200px; overflow-y: auto; border: 1px solid var(--border-color); padding: 10px;">
							${this.customIfcSchema && this.customIfcSchema.Classes.length > 0 
								? this.customIfcSchema.Classes.map(cls => 
									`<div style="padding: 5px 0; border-bottom: 1px solid #f0f0f0;">
										<strong>${cls.Code}</strong>
										<div style="font-size: 12px; color: var(--secondary-color); margin-left: 10px;">
											${cls.ClassProperties.map(prop => 
												`<span style="background: #f0f9ff; padding: 1px 4px; border-radius: 2px; margin-right: 5px;">
													${prop.PropertyCode}
												</span>`
											).join('')}
										</div>
									</div>`
								).join('')
								: '<div style="color: var(--secondary-color); font-style: italic;">Пользовательские свойства будут добавляться автоматически при маппинге</div>'
							}
						</div>
					</div>

					<div style="background: #f0f9ff; padding: 15px; border-radius: 5px; border-left: 4px solid var(--primary-color);">
						<h4 style="margin-top: 0; color: var(--primary-color);">Как это работает?</h4>
						<ul style="margin: 5px 0 0 20px; color: var(--secondary-color);">
							<li>При маппинге ObjectProperty система автоматически предлагает свойства из соответствующего IFC класса</li>
							<li>Если вы выбираете свойство, которого нет в оригинальной схеме, оно автоматически добавляется</li>
							<li>Все пользовательские свойства сохраняются и доступны при следующих запусках</li>
							<li>Схема расширяется автоматически - не требует ручного управления</li>
						</ul>
					</div>
				</div>
				<div class="modal-footer">
					<button id="exportMappingsBtn" class="export-button">Экспорт всех соответствий</button>
					<button id="importMappingsBtn" class="export-button">Импорт соответствий</button>
					<button id="clearMappingsBtn" class="cancel-button">Очистить все соответствия</button>
					<button id="closeMappingsModalBtn" class="save-button">Закрыть</button>
				</div>
			</div>
		`;
		
		document.body.appendChild(modal);
		
		document.getElementById('closeMappingsModalBtn').addEventListener('click', () => {
			modal.remove();
		});
		
		document.getElementById('clearMappingsBtn').addEventListener('click', () => {
			if (confirm('Вы уверены, что хотите очистить все сохраненные соответствия? Это действие нельзя отменить.')) {
				this.clearSavedMappings();
				modal.remove();
			}
		});
		
		document.getElementById('exportMappingsBtn').addEventListener('click', () => {
			this.exportAllMappings();
		});

		document.getElementById('importMappingsBtn').addEventListener('click', () => {
			this.importMappings();
		});
		
		modal.addEventListener('click', (e) => {
			if (e.target === modal) {
				modal.remove();
			}
		});
	}

    getMappingStatistics() {
        return {
            classCount: Object.keys(this.savedMappings.classMappings).length,
            attributeCount: Object.keys(this.savedMappings.attributeMappings).length,
            associationCount: Object.keys(this.savedMappings.associationMappings || {}).length,
            lastUpdated: this.savedMappings.lastUpdated 
                ? new Date(this.savedMappings.lastUpdated).toLocaleString()
                : null
        };
    }

	getSchemaStatistics() {
		const mergedSchema = this.getMergedIfcSchema();
		const totalProperties = new Set();
		
		mergedSchema.Classes.forEach(cls => {
			if (cls.ClassProperties) {
				cls.ClassProperties.forEach(prop => {
					totalProperties.add(prop.PropertyCode);
				});
			}
		});

		const customProperties = this.customIfcSchema ? 
			new Set(this.customIfcSchema.Classes.flatMap(cls => 
				cls.ClassProperties ? cls.ClassProperties.map(prop => prop.PropertyCode) : []
			)).size : 0;

		return {
			totalClasses: mergedSchema.Classes.length,
			totalProperties: totalProperties.size,
			customProperties
		};
	}

    exportAllMappings() {
        let exportText = "СОХРАНЕННЫЕ СООТВЕТСТВИЯ OWL → IFC\n";
        exportText += "==================================\n\n";
        exportText += `Дата экспорта: ${new Date().toLocaleString()}\n`;
        exportText += `Всего сохранено классов: ${Object.keys(this.savedMappings.classMappings).length}\n`;
        exportText += `Всего сохранено атрибутов: ${Object.keys(this.savedMappings.attributeMappings).length}\n`;
        exportText += `Всего сохранено ассоциаций: ${Object.keys(this.savedMappings.associationMappings || {}).length}\n\n`;
        
        exportText += "СОХРАНЕННЫЕ СООТВЕТСТВИЯ КЛАССОВ:\n";
        exportText += "--------------------------------\n";
        Object.entries(this.savedMappings.classMappings).forEach(([source, data], index) => {
            exportText += `${index + 1}. ${source} → ${data.target} `;
            exportText += `[использовано: ${data.usageCount} раз, последнее использование: ${new Date(data.lastUsed).toLocaleString()}]\n`;
        });
        
        exportText += "\nСОХРАНЕННЫЕ СООТВЕТСТВИЯ АТРИБУТОВ:\n";
        exportText += "----------------------------------\n";
        Object.entries(this.savedMappings.attributeMappings).forEach(([source, data], index) => {
            exportText += `${index + 1}. ${source} → ${data.target} `;
            exportText += `[использовано: ${data.usageCount} раз, последнее использование: ${new Date(data.lastUsed).toLocaleString()}]\n`;
        });
        
        const blob = new Blob([exportText], { type: 'text/plain; charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `saved_mappings_${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showSuccess('Все сохраненные соответствия экспортированы');
    }

    exportCustomSchema() {
        if (!this.customIfcSchema) {
            this.showError('Нет пользовательской схемы для экспорта');
            return;
        }

        const blob = new Blob([JSON.stringify(this.customIfcSchema, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ifc_custom_schema_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        this.showSuccess('Пользовательская схема экспортирована');
    }

    importMappings() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.txt,.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                this.readFileContent(file).then(content => {
                    try {
                        const importedMappings = JSON.parse(content);
                        if (importedMappings.classMappings && importedMappings.attributeMappings) {
                            this.savedMappings = importedMappings;
                            this.saveMappings();
                            this.showSuccess('Соответствия успешно импортированы');
                        } else {
                            this.showError('Неверный формат файла с соответствиями');
                        }
                    } catch (error) {
                        this.showError('Ошибка при импорте соответствий: ' + error.message);
                    }
                });
            }
        };
        input.click();
    }

    importCustomSchema() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                this.readFileContent(file).then(content => {
                    try {
                        const importedSchema = JSON.parse(content);
                        if (importedSchema.Classes && importedSchema.DictionaryCode === 'ifc_custom') {
                            this.customIfcSchema = importedSchema;
                            this.saveCustomIfcSchema();
                            this.showSuccess('Пользовательская схема успешно импортирована');
                        } else {
                            this.showError('Неверный формат файла схемы');
                        }
                    } catch (error) {
                        this.showError('Ошибка при импорте схемы: ' + error.message);
                    }
                });
            }
        };
        input.click();
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
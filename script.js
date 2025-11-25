// script.js
class IfcModelMapper {
    constructor() {
        this.sourceEditor = null;
        this.targetEditor = null;
        this.currentMapping = null;
        this.isEditorsReady = false;
        this.ifcSchema = null;
        this.customIfcSchema = null;
        this.selectedClassForAttributes = null;
        this.attributePanelHeight = this.loadAttributePanelHeight();
        this.attributeResizerInitialized = false;
        this.attributePanelIsResizing = false;
        this.attributesByDomain = new Map();
        this.allIfcPropertiesCache = null;
        this.searchableSelectGlobalHandler = null;
        this.propertySetStructure = null;
        this.classPropertySetCache = new Map();
        this.customPropertySets = this.loadCustomPropertySets();
        
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
            this.invalidatePropertySetCache();
            console.log('IFC schema loaded:', this.ifcSchema);
        } catch (error) {
            console.error('Error loading IFC schema:', error);
            // Запасные данные на случай ошибки загрузки
            this.ifcSchema = {
                Classes: [],
                ModelVersion: "2.0",
                DictionaryVersion: "4.3"
            };
            this.invalidatePropertySetCache();
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

    // Загрузка пользовательских PropertySet
    loadCustomPropertySets() {
        try {
            const saved = localStorage.getItem('ifcMapperCustomPropertySets');
            if (!saved) return {};
            const parsed = JSON.parse(saved);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (error) {
            console.error('Error loading custom property sets:', error);
            return {};
        }
    }

    saveCustomPropertySets() {
        try {
            localStorage.setItem('ifcMapperCustomPropertySets', JSON.stringify(this.customPropertySets || {}));
        } catch (error) {
            console.error('Error saving custom property sets:', error);
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

    // Извлечение базового класса и PredefinedType из имени класса
    // Например: "IfcRoadPartBICYCLECROSSING" -> { baseClass: "IfcRoadPart", predefinedType: "BICYCLECROSSING" }
    // Или: "IfcRoadPartBUS_STOP" -> { baseClass: "IfcRoadPart", predefinedType: "BUS_STOP" }
    parseIfcClassName(className) {
        if (!className) return { baseClass: null, predefinedType: null };
        
        // Проверяем, есть ли в схеме класс с таким именем и есть ли у него ParentClassCode
        const schema = this.getMergedIfcSchema();
        const cls = schema.Classes.find(c => c.Code === className);
        
        if (cls && cls.ParentClassCode) {
            // Проверяем, является ли это классом с PredefinedType
            // Это класс с PredefinedType, если есть ParentClassCode и Description содержит упоминание о Predefined Type
            const isPredefinedType = cls.Description && 
                (cls.Description.toLowerCase().includes("predefined type") || 
                 cls.Description.toLowerCase().includes("predefined"));
            
            if (isPredefinedType) {
                // Извлекаем PredefinedType из имени: IfcRoadPartBICYCLECROSSING -> BICYCLECROSSING
                const baseClass = cls.ParentClassCode;
                if (className.startsWith(baseClass)) {
                    const predefinedType = className.substring(baseClass.length);
                    // Проверяем, что PredefinedType состоит только из заглавных букв и подчеркиваний
                    if (/^[A-Z_]+$/.test(predefinedType)) {
                        return { baseClass, predefinedType };
                    }
                }
            }
        }
        
        return { baseClass: className, predefinedType: null };
    }

    // Получение всех доступных PredefinedType для базового класса
    getPredefinedTypesForClass(baseClass) {
        if (!baseClass) return [];
        
        const schema = this.getMergedIfcSchema();
        const predefinedTypes = [];
        
        schema.Classes.forEach(cls => {
            if (cls.ParentClassCode === baseClass) {
                // Проверяем, является ли это классом с PredefinedType
                const isPredefinedType = cls.Description && 
                    (cls.Description.toLowerCase().includes("predefined type") || 
                     cls.Description.toLowerCase().includes("predefined"));
                
                if (isPredefinedType) {
                    // Извлекаем PredefinedType из Code
                    const parsed = this.parseIfcClassName(cls.Code);
                    if (parsed.predefinedType) {
                        predefinedTypes.push(parsed.predefinedType);
                    }
                }
            }
        });
        
        return [...new Set(predefinedTypes)].sort();
    }

    // Получение всех IFC классов из объединенной схемы (только базовые классы)
    getIfcClasses() {
        const schema = this.getMergedIfcSchema();
        const baseClasses = new Set();
        
        schema.Classes.forEach(cls => {
            const parsed = this.parseIfcClassName(cls.Code);
            baseClasses.add(parsed.baseClass);
        });
        
        return Array.from(baseClasses).sort();
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
        if (this.allIfcPropertiesCache) {
            return this.allIfcPropertiesCache;
        }

        const schema = this.getMergedIfcSchema();
        const allProperties = new Set();
        
        schema.Classes.forEach(cls => {
            if (cls.ClassProperties) {
                cls.ClassProperties.forEach(prop => {
                    allProperties.add(prop.PropertyCode);
                });
            }
        });
        
        this.allIfcPropertiesCache = Array.from(allProperties).sort();
        return this.allIfcPropertiesCache;
    }

    loadAttributePanelHeight() {
        try {
            const saved = localStorage.getItem('ifcMapperAttributePanelHeight');
            if (saved) {
                const parsed = parseInt(saved, 10);
                if (!isNaN(parsed)) {
                    return this.clampAttributePanelHeight(parsed);
                }
            }
        } catch (error) {
            console.warn('Unable to load attribute panel height:', error);
        }
        return 360;
    }

    saveAttributePanelHeight(height) {
        try {
            localStorage.setItem('ifcMapperAttributePanelHeight', String(height));
        } catch (error) {
            console.warn('Unable to save attribute panel height:', error);
        }
    }

    clampAttributePanelHeight(value) {
        const min = 220;
        const viewportMax = (typeof window !== 'undefined' && window.innerHeight)
            ? Math.max(320, window.innerHeight - 220)
            : 700;
        const max = Math.max(min + 100, Math.min(700, viewportMax));
        return Math.min(Math.max(value, min), max);
    }

    applyAttributePanelHeight() {
        const panel = document.getElementById('attributePanel');
        if (!panel) return;
        const height = this.clampAttributePanelHeight(this.attributePanelHeight || 360);
        this.attributePanelHeight = height;
        panel.style.height = `${height}px`;
        panel.style.setProperty('--attribute-panel-height', `${height}px`);
    }

    bindAttributeResizer() {
        if (this.attributeResizerInitialized) return;
        const resizer = document.getElementById('attributeResizer');
        const panel = document.getElementById('attributePanel');
        if (!resizer || !panel) return;

        const startResize = (e) => {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = panel.offsetHeight;
            this.attributePanelIsResizing = true;
            document.body.classList.add('resizing-vertical');

            const onMouseMove = (moveEvent) => {
                if (!this.attributePanelIsResizing) return;
                const delta = startY - moveEvent.clientY;
                const newHeight = this.clampAttributePanelHeight(startHeight + delta);
                this.attributePanelHeight = newHeight;
                panel.style.height = `${newHeight}px`;
                panel.style.setProperty('--attribute-panel-height', `${newHeight}px`);
            };

            const stopResize = () => {
                if (!this.attributePanelIsResizing) return;
                this.attributePanelIsResizing = false;
                document.body.classList.remove('resizing-vertical');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', stopResize);
                this.saveAttributePanelHeight(this.attributePanelHeight);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', stopResize);
        };

        resizer.addEventListener('mousedown', startResize);
        this.attributeResizerInitialized = true;
    }

    getIfcDataTypes() {
        const baseProperties = this.ifcSchema?.Properties || [];
        const customProperties = this.customIfcSchema?.Properties || [];
        const dataTypes = new Set();

        [...baseProperties, ...customProperties].forEach(prop => {
            if (prop?.DataType) {
                dataTypes.add(prop.DataType);
            }
        });

        if (dataTypes.size === 0) {
            ['String', 'Boolean', 'Integer', 'Real', 'Number', 'Date', 'DateTime', 'Time'].forEach(type => dataTypes.add(type));
        }

        return Array.from(dataTypes).sort();
    }

    invalidatePropertySetCache() {
        this.propertySetStructure = null;
        this.classPropertySetCache = new Map();
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
            this.allIfcPropertiesCache = null;
            this.invalidatePropertySetCache();
			this.showSuccess(`Свойство "${propertyName}" добавлено к классу ${ifcClass}`);
		}
	}

    getPropertySetStructure() {
        if (this.propertySetStructure) {
            return this.propertySetStructure;
        }

        const schema = this.getMergedIfcSchema();
        const setToProps = new Map();
        const propToSets = new Map();
        const classToSetMap = new Map();

        if (schema?.Classes) {
            schema.Classes.forEach(cls => {
                const classMap = new Map();
                if (cls?.ClassProperties) {
                    cls.ClassProperties.forEach(prop => {
                        if (!prop?.PropertyCode) return;
                        const propertySet = prop.PropertySet || 'Pset_Custom';

                        if (!setToProps.has(propertySet)) {
                            setToProps.set(propertySet, new Set());
                        }
                        setToProps.get(propertySet).add(prop.PropertyCode);

                        if (!propToSets.has(prop.PropertyCode)) {
                            propToSets.set(prop.PropertyCode, new Set());
                        }
                        propToSets.get(prop.PropertyCode).add(propertySet);

                        if (!classMap.has(propertySet)) {
                            classMap.set(propertySet, new Set());
                        }
                        classMap.get(propertySet).add(prop.PropertyCode);
                    });
                }
                classToSetMap.set(cls.Code, classMap);
            });
        }

        // Всегда добавляем пользовательский PropertySet
        if (!setToProps.has('Pset_Custom')) {
            setToProps.set('Pset_Custom', new Set());
        }

        this.propertySetStructure = { setToProps, propToSets, classToSetMap };
        return this.propertySetStructure;
    }

    getAllPropertySets() {
        const structure = this.getPropertySetStructure();
        return Array.from(structure.setToProps.keys()).sort();
    }

    getPropertiesForPropertySet(propertySet, domainClass = null) {
        if (!propertySet) return [];
        const structure = this.getPropertySetStructure();

        if (domainClass) {
            const classMap = structure.classToSetMap.get(domainClass);
            if (classMap && classMap.has(propertySet)) {
                return Array.from(classMap.get(propertySet)).sort();
            }
        }

        const props = structure.setToProps.get(propertySet);
        return props ? Array.from(props).sort() : [];
    }

    getPropertySetsForClass(ifcClass) {
        if (!ifcClass) return new Map();
        if (this.classPropertySetCache.has(ifcClass)) {
            return this.classPropertySetCache.get(ifcClass);
        }

        const structure = this.getPropertySetStructure();
        const classMap = structure.classToSetMap.get(ifcClass) || new Map();
        this.classPropertySetCache.set(ifcClass, classMap);
        return classMap;
    }

    findPropertySetForProperty(propertyCode, ifcClass = null) {
        if (!propertyCode) return null;
        const structure = this.getPropertySetStructure();

        if (ifcClass) {
            const classMap = structure.classToSetMap.get(ifcClass);
            if (classMap) {
                for (const [setName, props] of classMap.entries()) {
                    if (props.has(propertyCode)) {
                        return setName;
                    }
                }
            }
        }

        const propSets = structure.propToSets.get(propertyCode);
        if (propSets && propSets.size > 0) {
            return Array.from(propSets)[0];
        }

        return null;
    }

    getPropertySelectorData(mapping, domainClass, options = {}) {
        const excludedSets = new Set(options.excludePropertySets || []);
        if (mapping.propertySet && excludedSets.has(mapping.propertySet)) {
            mapping.propertySet = null;
        }
        const allPropertySets = this.getAllPropertySets();
        const domainPropertySetNames = domainClass ? Array.from(this.getPropertySetsForClass(domainClass).keys()) : [];
        const propertySetLabel = mapping.propertySet || '-- Выберите PropertySet --';
        const propertySetOptions = [];
        propertySetOptions.push(`<div class="option ${mapping.propertySet ? '' : 'selected'}" data-value="" data-display="-- Выберите PropertySet --">-- Выберите PropertySet --</div>`);
        const seen = new Set();
        if (mapping.propertySet) {
            seen.add(mapping.propertySet);
        }
        if (domainClass && domainPropertySetNames.length > 0) {
            propertySetOptions.push(`<div class="option-group">PropertySet класса ${this.escapeHtml(domainClass)}</div>`);
            domainPropertySetNames.forEach(setName => {
                if (excludedSets.has(setName)) return;
                const escaped = this.escapeHtml(setName);
                propertySetOptions.push(`<div class="option ${setName === mapping.propertySet ? 'selected' : ''}" data-value="${escaped}">${escaped}</div>`);
                seen.add(setName);
            });
            propertySetOptions.push(`<div class="option-group">Все PropertySet'ы</div>`);
        }
        allPropertySets.forEach(setName => {
            if (excludedSets.has(setName)) return;
            if (seen.has(setName)) return;
            const escaped = this.escapeHtml(setName);
            propertySetOptions.push(`<div class="option ${setName === mapping.propertySet ? 'selected' : ''}" data-value="${escaped}">${escaped}</div>`);
            seen.add(setName);
        });
        if (mapping.propertySet && !seen.has(mapping.propertySet)) {
            const escaped = this.escapeHtml(mapping.propertySet);
            propertySetOptions.push(`<div class="option selected" data-value="${escaped}">${escaped}</div>`);
        }
        propertySetOptions.push(`<div class="option" data-value="__create_property_set__" data-display="+ Добавить PropertySet">+ Добавить PropertySet</div>`);

        let propertyLabel;
        let propertyOptions;
        const availableProperties = mapping.propertySet ? this.getPropertiesForPropertySet(mapping.propertySet, domainClass) : [];
        const isCustomValue = Boolean(mapping.target && !availableProperties.includes(mapping.target));

        if (!mapping.propertySet) {
            propertyLabel = 'Сначала выберите PropertySet';
            propertyOptions = '<div class="option" data-disabled="true" data-display="Сначала выберите PropertySet">Сначала выберите PropertySet</div>';
        } else {
            propertyLabel = mapping.target || '-- Выберите свойство --';
            const propertyOptionList = [
                `<div class="option ${isCustomValue ? 'selected' : ''}" data-value="custom">-- Другое --</div>`
            ];
            if (this.isCustomPropertySet(mapping.propertySet)) {
                propertyOptionList.push('<div class="option" data-value="__add_property__" data-display="+ Добавить свойство">+ Добавить свойство</div>');
            }
            if (availableProperties.length === 0) {
                propertyOptionList.push('<div class="option" data-disabled="true" data-display="Нет свойств в PropertySet">Нет свойств в PropertySet</div>');
            } else {
                availableProperties.forEach(prop => {
                    const escapedProp = this.escapeHtml(prop);
                    propertyOptionList.push(`<div class="option ${prop === mapping.target ? 'selected' : ''}" data-value="${escapedProp}">${escapedProp}</div>`);
                });
            }
            if (mapping.target && !availableProperties.includes(mapping.target) && !isCustomValue) {
                const escapedProp = this.escapeHtml(mapping.target);
                propertyOptionList.push(`<div class="option selected" data-value="${escapedProp}">${escapedProp}</div>`);
            }
            propertyOptions = propertyOptionList.join('');
        }

        return {
            propertySetLabel,
            propertyLabel,
            propertySetOptions: propertySetOptions.join(''),
            propertyOptions,
            isCustomValue
        };
    }

    isCustomPropertySet(propertySet) {
        if (!propertySet) return false;
        return Boolean(this.customPropertySets && this.customPropertySets[propertySet]);
    }

    addCustomPropertySet(propertySetName) {
        const normalized = propertySetName ? propertySetName.trim() : '';
        if (!normalized) {
            this.showError('Название PropertySet не может быть пустым');
            return null;
        }

        const exists = this.getAllPropertySets().some(name => name.toLowerCase() === normalized.toLowerCase());
        if (exists) {
            this.showError(`PropertySet "${normalized}" уже существует`);
            return null;
        }

        if (!this.customPropertySets) {
            this.customPropertySets = {};
        }
        this.customPropertySets[normalized] = [];
        this.saveCustomPropertySets();
        this.invalidatePropertySetCache();
        this.showSuccess(`PropertySet "${normalized}" добавлен`);
        this.renderPropertySetModal();
        return normalized;
    }

    addPropertyToCustomSet(propertySetName, propertyName) {
        if (!this.isCustomPropertySet(propertySetName)) {
            this.showError('Свойства можно добавлять только в пользовательские PropertySet');
            return null;
        }

        const normalizedProperty = propertyName ? propertyName.trim() : '';
        if (!normalizedProperty) {
            this.showError('Название свойства не может быть пустым');
            return null;
        }

        const existingProps = this.customPropertySets[propertySetName] || [];
        if (existingProps.some(prop => prop.toLowerCase() === normalizedProperty.toLowerCase())) {
            this.showError(`Свойство "${normalizedProperty}" уже существует в ${propertySetName}`);
            return null;
        }

        existingProps.push(normalizedProperty);
        this.customPropertySets[propertySetName] = existingProps;
        this.saveCustomPropertySets();
        this.invalidatePropertySetCache();
        this.showSuccess(`Свойство "${normalizedProperty}" добавлено в ${propertySetName}`);
        this.renderPropertySetModal();
        return normalizedProperty;
    }

    removeCustomPropertySet(propertySetName) {
        if (!this.isCustomPropertySet(propertySetName)) {
            this.showError('Нельзя удалить встроенный PropertySet');
            return;
        }
        const confirmRemoval = confirm(`Удалить PropertySet "${propertySetName}" и все его свойства?`);
        if (!confirmRemoval) return;

        delete this.customPropertySets[propertySetName];
        this.saveCustomPropertySets();
        this.invalidatePropertySetCache();
        this.resetMappingsForRemovedPropertySet(propertySetName);
        this.renderPropertySetModal();
        this.displayAssociationMapping();
        this.displayAttributeMapping();
        this.showSuccess(`PropertySet "${propertySetName}" удален`);
    }

    removePropertyFromCustomSet(propertySetName, propertyName) {
        if (!this.isCustomPropertySet(propertySetName)) {
            this.showError('Нельзя изменять встроенный PropertySet');
            return;
        }
        const props = this.customPropertySets[propertySetName] || [];
        const index = props.findIndex(prop => prop === propertyName);
        if (index === -1) {
            this.showError(`Свойство "${propertyName}" не найдено`);
            return;
        }
        props.splice(index, 1);
        this.customPropertySets[propertySetName] = props;
        this.saveCustomPropertySets();
        this.invalidatePropertySetCache();
        this.resetMappingsForRemovedProperty(propertySetName, propertyName);
        this.renderPropertySetModal();
        this.displayAssociationMapping();
        this.displayAttributeMapping();
        this.showSuccess(`Свойство "${propertyName}" удалено из ${propertySetName}`);
    }

    clearAllCustomPropertySets() {
        if (!this.customPropertySets || Object.keys(this.customPropertySets).length === 0) {
            this.showInfo('Пользовательские PropertySet отсутствуют');
            return;
        }
        if (!confirm('Удалить все пользовательские PropertySet?')) {
            return;
        }
        const removedSets = Object.keys(this.customPropertySets);
        this.customPropertySets = {};
        this.saveCustomPropertySets();
        this.invalidatePropertySetCache();
        removedSets.forEach(setName => this.resetMappingsForRemovedPropertySet(setName));
        this.renderPropertySetModal();
        this.displayAssociationMapping();
        this.displayAttributeMapping();
        this.showSuccess('Все пользовательские PropertySet удалены');
    }

    promptCreatePropertySet() {
        const name = prompt('Введите название нового PropertySet:');
        if (!name) return null;
        const created = this.addCustomPropertySet(name);
        if (created) {
            this.displayAssociationMapping();
            this.displayAttributeMapping();
        }
        return created;
    }

    promptAddPropertyToCustomSet(propertySetName) {
        const propertyName = prompt(`Введите название свойства для ${propertySetName}:`);
        if (!propertyName) return null;
        const created = this.addPropertyToCustomSet(propertySetName, propertyName);
        if (created) {
            this.displayAssociationMapping();
            this.displayAttributeMapping();
        }
        return created;
    }

    resetMappingsForRemovedPropertySet(propertySetName) {
        const resetMapping = (mapping) => {
            if (mapping && mapping.propertySet === propertySetName) {
                mapping.propertySet = null;
                mapping.target = null;
                if (mapping.verified) {
                    mapping.verified = false;
                }
            }
        };
        (this.currentMapping?.attributeMappings || []).forEach(resetMapping);
        (this.currentMapping?.associationMappings || []).forEach(resetMapping);
    }

    resetMappingsForRemovedProperty(propertySetName, propertyName) {
        const resetMapping = (mapping) => {
            if (mapping && mapping.propertySet === propertySetName && mapping.target === propertyName) {
                mapping.target = null;
                if (mapping.verified) {
                    mapping.verified = false;
                }
            }
        };
        (this.currentMapping?.attributeMappings || []).forEach(resetMapping);
        (this.currentMapping?.associationMappings || []).forEach(resetMapping);
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
                typeMappings: {},
                lastUpdated: null
            };
            
            if (saved) {
                const parsed = JSON.parse(saved);
                return {
                    ...defaultMappings,
                    ...parsed,
                    associationMappings: parsed.associationMappings || {},
                    typeMappings: parsed.typeMappings || {}
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
    addVerifiedMapping(type, source, target, options = {}) {
        if (type === 'class') {
            const predefinedType = options.predefinedType || null;
            this.savedMappings.classMappings[source] = {
                target: target,
                predefinedType: predefinedType,
                lastUsed: new Date().toISOString(),
                usageCount: (this.savedMappings.classMappings[source]?.usageCount || 0) + 1
            };
        } else if (type === 'attribute') {
            const propertySet = options.propertySet || null;
            this.savedMappings.attributeMappings[source] = {
                target: target,
                propertySet: propertySet,
                lastUsed: new Date().toISOString(),
                usageCount: (this.savedMappings.attributeMappings[source]?.usageCount || 0) + 1
            };
        } else if (type === 'association') {
            const propertySet = options.propertySet || null;
            this.savedMappings.associationMappings[source] = {
                target: target,
                propertySet: propertySet,
                lastUsed: new Date().toISOString(),
                usageCount: (this.savedMappings.associationMappings[source]?.usageCount || 0) + 1
            };
        } else if (type === 'type') {
            this.savedMappings.typeMappings[source] = {
                target: target,
                lastUsed: new Date().toISOString(),
                usageCount: (this.savedMappings.typeMappings?.[source]?.usageCount || 0) + 1
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
        } else if (type === 'type') {
            return this.savedMappings.typeMappings?.[source];
        }
        return null;
    }

    // Очистка всех сохраненных маппингов
    clearSavedMappings() {
        this.savedMappings = {
            classMappings: {},
            attributeMappings: {},
            associationMappings: {},
            typeMappings: {},
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

            // Обработчик изменений в исходном редакторе для обновления списков
            let updateTimeout;
            this.sourceEditor.onDidChangeModelContent(() => {
                clearTimeout(updateTimeout);
                updateTimeout = setTimeout(() => {
                    this.updateOwlLists();
                }, 500); // Задержка для избежания частых обновлений
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
            // Обновляем списки классов и свойств при инициализации
            setTimeout(() => this.updateOwlLists(), 200);
            this.showSuccess('Редакторы загружены и готовы к работе');
        });
    }

    initTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');
                // Определяем, к какому контейнеру относится вкладка
                const container = button.closest('.tabs-container');
                if (container && container.classList.contains('source-tabs-container')) {
                    this.switchSourceTab(tabId);
                } else {
                    this.switchTab(tabId);
                }
            });
        });
    }

    switchTab(tabId) {
        // Для правой панели (target)
        const targetContainer = document.querySelector('.tabs-container:not(.source-tabs-container)');
        if (targetContainer) {
            targetContainer.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('active');
            });
            const button = targetContainer.querySelector(`[data-tab="${tabId}"]`);
            if (button) button.classList.add('active');

            targetContainer.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.remove('active');
            });
            const pane = targetContainer.querySelector(`#${tabId}`);
            if (pane) pane.classList.add('active');
        }

        setTimeout(() => {
            if (this.targetEditor) {
                this.targetEditor.layout();
            }
        }, 100);
    }

    switchSourceTab(tabId) {
        // Для левой панели (source)
        const sourceContainer = document.querySelector('.source-tabs-container');
        if (sourceContainer) {
            sourceContainer.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('active');
            });
            const button = sourceContainer.querySelector(`[data-tab="${tabId}"]`);
            if (button) button.classList.add('active');

            sourceContainer.querySelectorAll('.tab-pane').forEach(pane => {
                pane.classList.remove('active');
            });
            const pane = sourceContainer.querySelector(`#${tabId}`);
            if (pane) pane.classList.add('active');
        }

        setTimeout(() => {
            if (this.sourceEditor) {
                this.sourceEditor.layout();
            }
        }, 100);
    }

    bindEvents() {
        document.getElementById('convertBtn').addEventListener('click', () => this.convertToIfc());
        document.getElementById('fileInput').addEventListener('change', (e) => this.handleFileUpload(e));
        document.getElementById('detectTypeBtn').addEventListener('click', () => this.autoDetectType());
        document.getElementById('validateSourceBtn').addEventListener('click', () => this.validateSource());
        //document.getElementById('downloadBtn').addEventListener('click', () => this.downloadIfc());
        document.getElementById('formatSourceBtn').addEventListener('click', () => this.formatSource());
        document.getElementById('exportMappingBtn').addEventListener('click', () => this.exportMapping());
        
        document.getElementById('fullscreenSourceBtn').addEventListener('click', () => this.toggleFullscreen('source'));
        document.getElementById('fullscreenTargetBtn').addEventListener('click', () => this.toggleFullscreen('target'));
        
        document.getElementById('advancedSettingsBtn').addEventListener('click', () => this.showAdvancedSettings());
        document.getElementById('saveSettingsBtn').addEventListener('click', () => this.saveAdvancedSettings());
        document.getElementById('cancelSettingsBtn').addEventListener('click', () => this.hideAdvancedSettings());
        
        document.getElementById('validateMappingBtn').addEventListener('click', () => this.validateMapping());

        const managePropertySetsBtn = document.getElementById('managePropertySetsBtn');
        if (managePropertySetsBtn) {
            managePropertySetsBtn.addEventListener('click', () => this.showPropertySetModal());
        }
        const addPropertySetBtn = document.getElementById('addPropertySetBtn');
        if (addPropertySetBtn) {
            addPropertySetBtn.addEventListener('click', () => this.promptCreatePropertySet());
        }
        const clearPropertySetsBtn = document.getElementById('clearAllPropertySetsBtn');
        if (clearPropertySetsBtn) {
            clearPropertySetsBtn.addEventListener('click', () => this.clearAllCustomPropertySets());
        }
        const closePropertySetModalBtn = document.getElementById('closePropertySetModalBtn');
        if (closePropertySetModalBtn) {
            closePropertySetModalBtn.addEventListener('click', () => this.hidePropertySetModal());
        }
        const propertySetModalCloseFooter = document.getElementById('propertySetModalCloseFooter');
        if (propertySetModalCloseFooter) {
            propertySetModalCloseFooter.addEventListener('click', () => this.hidePropertySetModal());
        }
        const propertySetList = document.getElementById('customPropertySetList');
        if (propertySetList) {
            propertySetList.addEventListener('click', (e) => {
                const action = e.target.getAttribute('data-action');
                if (!action) return;
                const setName = e.target.getAttribute('data-set');
                if (!setName) return;
                if (action === 'add-property') {
                    this.promptAddPropertyToCustomSet(setName);
                } else if (action === 'remove-set') {
                    this.removeCustomPropertySet(setName);
                } else if (action === 'remove-property') {
                    const property = e.target.getAttribute('data-property');
                    if (property) {
                        this.removePropertyFromCustomSet(setName, property);
                    }
                }
            });
        }

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
            // Обновляем списки классов и свойств
            setTimeout(() => this.updateOwlLists(), 100);
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
		const sourceTypeSelect = document.getElementById('sourceType');
		let sourceType = sourceTypeSelect.value;
        
        if (!sourceCode.trim() || sourceCode.includes('// Вставьте вашу исходную модель здесь')) {
            this.showError('Исходная модель пуста или содержит только пример');
            return;
        }
        
        try {
			// Автоопределение типа при режиме auto/text/пусто
			if (!sourceType || sourceType === 'auto' || sourceType === 'text') {
				const detectedType = this.detectTypeFromContent(sourceCode);
				if (!detectedType || detectedType === 'text') {
					this.showError('Не удалось определить тип исходной модели. Укажите тип вручную.');
					return;
				}
				sourceType = detectedType;
				// Синхронизируем UI и язык редактора
				sourceTypeSelect.value = detectedType;
				this.setEditorLanguage(detectedType);
				this.showInfo(`Тип модели определен как: ${detectedType}`);
			}

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
        // Вспомогательная: извлечь локальное имя из QName/IRI
        const toLocalName = (token) => {
            if (!token) return null;
            let t = token.trim().replace(/[.;]$/, '');
            const iriMatch = t.match(/^<([^>]+)>$/);
            if (iriMatch) {
                const iri = iriMatch[1];
                const hashIdx = iri.lastIndexOf('#');
                if (hashIdx >= 0 && hashIdx < iri.length - 1) return iri.substring(hashIdx + 1);
                const slashIdx = iri.lastIndexOf('/');
                if (slashIdx >= 0 && slashIdx < iri.length - 1) return iri.substring(slashIdx + 1);
                return iri;
            }
            const qnameMatch = t.match(/^([A-Za-z_][\w-]*:)?([\w-]+)$/);
            if (qnameMatch) return qnameMatch[2];
            return null;
        };

        // Разбиваем на блоки по завершающей точке
        const blocks = [];
        let buffer = '';
        for (const rawLine of turtleCode.split('\n')) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            buffer += (buffer ? ' ' : '') + line;
            if (line.endsWith('.')) {
                blocks.push(buffer);
                buffer = '';
            }
        }
        if (buffer) blocks.push(buffer);

        const classes = [];
        const properties = [];
        const associations = [];

        blocks.forEach(block => {
            // Классы
            const classDecl = block.match(/^(.+?)\s+(a|rdf:type)\s+owl:Class\b/);
            if (classDecl) {
                const subject = toLocalName(classDecl[1]);
                if (subject) {
                    classes.push({
                        name: subject,
                        type: 'Class',
                        label: this.extractLabel(turtleCode, subject)
                    });
                }
            }

            // Свойства (Object/Datatype)
            const propDecl = block.match(/^(.+?)\s+(a|rdf:type)\s+owl:(ObjectProperty|DatatypeProperty)\b/);
            if (propDecl) {
                const subject = toLocalName(propDecl[1]);
                const propertyType = propDecl[3];
                if (subject) {
                    // Ищем domain / range / cardinality в пределах блока
                    const domainMatch = block.match(/rdfs:domain\s+([^;\.]+)[;\.]/);
                    const rangeMatch = block.match(/rdfs:range\s+([^;\.]+)[;\.]/);
                    const cardinalityMatch = block.match(/owl:cardinality\s+"([^"]+)"/);

                    const domain = domainMatch ? toLocalName(domainMatch[1]) : null;
                    const rangeToken = rangeMatch ? rangeMatch[1].trim() : null;
                    let range = null;

                    if (propertyType === 'ObjectProperty') {
                        range = rangeToken ? toLocalName(rangeToken) : null;
                    } else {
                        range = rangeToken ? this.formatDatatype(rangeToken) : null;
                    }
                    const cardinality = cardinalityMatch ? cardinalityMatch[1] : null;

                    if (propertyType === 'ObjectProperty') {
                        associations.push({
                            name: subject,
                            type: 'ObjectProperty',
                            label: this.extractLabel(turtleCode, subject),
                            domain: domain,
                            range: range,
                            cardinality: cardinality
                        });
                    } else {
                        properties.push({
                            name: subject,
                            type: 'DatatypeProperty',
                            label: this.extractLabel(turtleCode, subject),
                            domain: domain,
                            range: range
                        });
                    }
                }
            }
        });

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

    // Парсинг OWL с сохранением позиций для навигации
    parseOwlWithPositions(turtleCode) {
        const toLocalName = (token) => {
            if (!token) return null;
            let t = token.trim().replace(/[.;]$/, '');
            const iriMatch = t.match(/^<([^>]+)>$/);
            if (iriMatch) {
                const iri = iriMatch[1];
                const hashIdx = iri.lastIndexOf('#');
                if (hashIdx >= 0 && hashIdx < iri.length - 1) return iri.substring(hashIdx + 1);
                const slashIdx = iri.lastIndexOf('/');
                if (slashIdx >= 0 && slashIdx < iri.length - 1) return iri.substring(slashIdx + 1);
                return iri;
            }
            const qnameMatch = t.match(/^([A-Za-z_][\w-]*:)?([\w-]+)$/);
            if (qnameMatch) return qnameMatch[2];
            return null;
        };

        const classes = [];
        const datatypeProperties = [];
        const objectProperties = [];
        const lines = turtleCode.split('\n');
        
        const blocks = [];
        let buffer = '';
        let blockStartLine = 0;
        lines.forEach((rawLine, index) => {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) return;
            if (!buffer) blockStartLine = index;
            buffer += (buffer ? ' ' : '') + line;
            if (line.endsWith('.')) {
                blocks.push({ text: buffer, startLine: blockStartLine });
                buffer = '';
            }
        });
        if (buffer) {
            blocks.push({ text: buffer, startLine: blockStartLine });
        }

        const findDefinitionPosition = (subject, startLine, keyword) => {
            for (let i = startLine; i < lines.length && i < startLine + 40; i++) {
                const raw = lines[i];
                if (!raw) continue;
                const trimmed = raw.trim();
                if (!trimmed || trimmed.startsWith('#')) continue;
                if (raw.includes(subject) && (!keyword || raw.includes(keyword))) {
                    return {
                        lineNumber: i + 1,
                        column: Math.max(raw.indexOf(subject) + 1, 1)
                    };
                }
            }
            return {
                lineNumber: startLine + 1,
                column: 1
            };
        };
        
        blocks.forEach(block => {
            const classDecl = block.text.match(/^(.+?)\s+(a|rdf:type)\s+owl:Class\b/);
            if (classDecl) {
                const subject = toLocalName(classDecl[1]);
                if (subject && !classes.find(c => c.name === subject)) {
                    const position = findDefinitionPosition(subject, block.startLine, 'owl:Class');
                    classes.push({
                        name: subject,
                        label: this.extractLabel(turtleCode, subject),
                        lineNumber: position.lineNumber,
                        column: position.column
                    });
                }
            }

            const propDecl = block.text.match(/^(.+?)\s+(a|rdf:type)\s+owl:(ObjectProperty|DatatypeProperty)\b/);
            if (propDecl) {
                const subject = toLocalName(propDecl[1]);
                const propertyType = propDecl[3];
                if (subject) {
                    const position = findDefinitionPosition(subject, block.startLine, `owl:${propertyType}`);
                    const entry = {
                        name: subject,
                        type: propertyType,
                        label: this.extractLabel(turtleCode, subject),
                        lineNumber: position.lineNumber,
                        column: position.column
                    };
                    if (propertyType === 'ObjectProperty') {
                        if (!objectProperties.find(p => p.name === subject)) {
                            objectProperties.push(entry);
                        }
                    } else if (propertyType === 'DatatypeProperty') {
                        if (!datatypeProperties.find(p => p.name === subject)) {
                            datatypeProperties.push(entry);
                        }
                    }
                }
            }
        });

        return { classes, datatypeProperties, objectProperties };
    }

    // Обновление списков классов и свойств
    updateOwlLists() {
        if (!this.sourceEditor) return;
        
        const sourceCode = this.sourceEditor.getValue();
        if (!sourceCode || sourceCode.trim().length === 0) {
            this.clearOwlLists();
            return;
        }

        try {
            const parsed = this.parseOwlWithPositions(sourceCode);
            this.displayOwlClasses(parsed.classes);
            this.displayOwlDatatypeProperties(parsed.datatypeProperties);
            this.displayOwlObjectProperties(parsed.objectProperties);
        } catch (error) {
            console.error('Ошибка парсинга OWL:', error);
            this.clearOwlLists();
        }
    }

    renderOwlList(containerId, items, options) {
        const container = document.getElementById(containerId);
        if (!container) return;
        const { emptyText } = options;

        if (!items || items.length === 0) {
            container.innerHTML = `<div class="no-items">${emptyText}</div>`;
            return;
        }

        container.innerHTML = '';
        items.forEach(item => {
            const element = document.createElement('div');
            element.className = 'owl-list-item';
            element.innerHTML = `
                <div class="owl-list-item-name">${this.escapeHtml(item.name)}</div>
                ${item.label && item.label !== item.name ? `<div class="owl-list-item-label">${this.escapeHtml(item.label)}</div>` : ''}
            `;
            element.addEventListener('dblclick', () => this.navigateToDefinition(item, item.name));
            container.appendChild(element);
        });
    }

    displayOwlClasses(classes) {
        this.renderOwlList('owlClassesList', classes, {
            emptyText: 'Классы не найдены'
        });
    }

    displayOwlDatatypeProperties(properties) {
        this.renderOwlList('owlDatatypeList', properties, {
            emptyText: 'DatatypeProperty не найдены'
        });
    }

    displayOwlObjectProperties(properties) {
        this.renderOwlList('owlObjectList', properties, {
            emptyText: 'ObjectProperty не найдены'
        });
    }

    // Очистка списков
    clearOwlLists() {
        const classesContainer = document.getElementById('owlClassesList');
        const datatypeContainer = document.getElementById('owlDatatypeList');
        const objectContainer = document.getElementById('owlObjectList');
        
        if (classesContainer) {
            classesContainer.innerHTML = '<div class="no-items">Загрузите OWL файл для просмотра классов</div>';
        }
        if (datatypeContainer) {
            datatypeContainer.innerHTML = '<div class="no-items">Загрузите OWL файл для просмотра DatatypeProperty</div>';
        }
        if (objectContainer) {
            objectContainer.innerHTML = '<div class="no-items">Загрузите OWL файл для просмотра ObjectProperty</div>';
        }
    }

    // Навигация к определению в тексте
    navigateToDefinition(elementInfo, elementName) {
        if (!this.sourceEditor) return;

        // Переключаемся на вкладку "Текст"
        this.switchSourceTab('source-text');

        // Ждем немного, чтобы вкладка переключилась
        setTimeout(() => {
            const model = this.sourceEditor.getModel();
            const lineNumber = elementInfo.lineNumber || 1;
            const column = elementInfo.column || 1;
            
            // Переходим к позиции
            const position = { lineNumber, column };
            this.sourceEditor.setPosition(position);
            this.sourceEditor.revealLineInCenter(lineNumber);
            
            // Выделяем строку
            const lineLength = model.getLineLength(lineNumber);
            this.sourceEditor.setSelection({
                startLineNumber: lineNumber,
                startColumn: 1,
                endLineNumber: lineNumber,
                endColumn: lineLength + 1
            });

            // Фокус на редактор
            this.sourceEditor.focus();
        }, 100);
    }

    // Экранирование HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    generateReadableName(technicalName) {
        return technicalName
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^\w/, c => c.toUpperCase())
            .trim();
    }

    formatDatatype(value) {
        if (!value) return null;
        const trimmed = value.trim().replace(/[.;]$/, '');
        const knownPrefixes = [
            { iri: 'http://www.w3.org/2001/XMLSchema#', prefix: 'xsd:' },
            { iri: 'https://www.w3.org/2001/XMLSchema#', prefix: 'xsd:' },
            { iri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#', prefix: 'rdf:' },
            { iri: 'http://www.w3.org/2000/01/rdf-schema#', prefix: 'rdfs:' }
        ];

        for (const { iri, prefix } of knownPrefixes) {
            if (trimmed.startsWith(iri)) {
                return `${prefix}${trimmed.substring(iri.length)}`;
            }
        }

        if (trimmed.startsWith('#')) {
            return trimmed.substring(1);
        }

        return trimmed;
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
                const rangeMatch = /<rdfs:range[^>]*rdf:resource="#?([\w-]+)"/.exec(propBlock);
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
                const datatypeRangeMatch = /<rdfs:range[^>]*rdf:resource="([^"]+)"/.exec(propBlock);
                if (datatypeRangeMatch) {
                    range = this.formatDatatype(datatypeRangeMatch[1]);
                }

                properties.push({
                    name: propertyName,
                    type: 'DatatypeProperty',
                    label: labelMatch ? labelMatch[1] : this.generateReadableName(propertyName),
                    domain: domain,
                    range: range
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
            typeMappings: [],
            associationMappings: [],
            timestamp: new Date().toISOString()
        };
        this.attributesByDomain = new Map();
        this.allIfcPropertiesCache = null;

        if (sourceModel.classes && sourceModel.classes.length > 0) {
            sourceModel.classes.forEach(cls => {
                const savedMapping = this.getSavedMapping('class', cls.name);
                let defaultMapping;
                let verified = false;

                if (savedMapping) {
                    // Если в сохраненном маппинге есть PredefinedType, используем его
                    // Иначе парсим из target на случай, если target содержит PredefinedType
                    const parsed = savedMapping.predefinedType ? 
                        { baseClass: savedMapping.target, predefinedType: savedMapping.predefinedType } :
                        this.parseIfcClassName(savedMapping.target);
                    
                    defaultMapping = parsed.baseClass || savedMapping.target;
                    verified = true;
                    
                    this.currentMapping.classMappings.push({
                        source: cls.name,
                        target: defaultMapping,
                        predefinedType: parsed.predefinedType || null,
                        label: cls.label,
                        type: 'class',
                        verified: verified
                    });
                } else {
                    defaultMapping = this.getDefaultClassMapping(cls.name);
                    
                    // Парсим базовый класс и PredefinedType из defaultMapping
                    const parsed = this.parseIfcClassName(defaultMapping);
                    
                    this.currentMapping.classMappings.push({
                        source: cls.name,
                        target: parsed.baseClass || defaultMapping,
                        predefinedType: parsed.predefinedType || null,
                        label: cls.label,
                        type: 'class',
                        verified: verified
                    });
                }
            });
        }

        if (sourceModel.properties && sourceModel.properties.length > 0) {
            sourceModel.properties.forEach((prop, index) => {
                const savedMapping = this.getSavedMapping('attribute', prop.name);
                let targetProperty = null;
                let propertySet = null;
                let verified = false;

                if (savedMapping) {
                    targetProperty = savedMapping.target || null;
                    propertySet = savedMapping.propertySet || null;
                    verified = true;
                } else {
                    const defaults = this.getDefaultAttributeMapping(prop.name, prop.domain);
                    targetProperty = defaults.property || null;
                    propertySet = defaults.propertySet || null;
                }

                if (!propertySet && targetProperty) {
                    const domainClass = prop.domain ? this.getMappedIfcClass(prop.domain) : null;
                    propertySet = this.findPropertySetForProperty(targetProperty, domainClass);
                }

                const attributeEntry = {
                    source: prop.name,
                    target: targetProperty,
                    label: prop.label,
                    type: 'attribute',
                    domain: prop.domain,
                    range: prop.range,
                    propertySet: propertySet || null,
                    verified: verified
                };

                this.currentMapping.attributeMappings.push(attributeEntry);

                const domainKey = prop.domain || '__NO_DOMAIN__';
                if (!this.attributesByDomain.has(domainKey)) {
                    this.attributesByDomain.set(domainKey, []);
                }
                this.attributesByDomain.get(domainKey).push({
                    mapping: attributeEntry,
                    index: this.currentMapping.attributeMappings.length - 1
                });
            });
        }

        this.selectedClassForAttributes = this.getInitialAttributeClassSelection();

        const typeMappings = new Map();
        if (sourceModel.properties && sourceModel.properties.length > 0) {
            sourceModel.properties.forEach(prop => {
                if (!prop.range) return;
                const rangeKey = prop.range.trim();
                if (!rangeKey) return;
                if (typeMappings.has(rangeKey)) return;

                const savedMapping = this.getSavedMapping('type', rangeKey);
                let defaultMapping;
                let verified = false;

                if (savedMapping) {
                    defaultMapping = savedMapping.target;
                    verified = true;
                } else {
                    defaultMapping = this.getDefaultTypeMapping(prop.range);
                }

                typeMappings.set(rangeKey, {
                    source: rangeKey,
                    target: defaultMapping,
                    label: rangeKey,
                    type: 'type',
                    verified: verified
                });
            });
        }
        this.currentMapping.typeMappings = Array.from(typeMappings.values());
        
        if (sourceModel.associations && sourceModel.associations.length > 0) {
            sourceModel.associations.forEach(assoc => {
                const savedMapping = this.getSavedMapping('association', assoc.name);
                let defaultAssociation = { property: null, propertySet: null };
                let verified = false;

                if (savedMapping) {
                    defaultAssociation.property = savedMapping.target || null;
                    defaultAssociation.propertySet = savedMapping.propertySet || null;
                    if (defaultAssociation.propertySet === 'Attributes') {
                        defaultAssociation.propertySet = null;
                    }
                    verified = true;
                } else {
                    defaultAssociation = this.getDefaultAssociationMapping(assoc.name, assoc.domain, assoc.range) || defaultAssociation;
                }

                this.currentMapping.associationMappings.push({
                    source: assoc.name,
                    target: defaultAssociation.property || null,
                    propertySet: defaultAssociation.propertySet || null,
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
        this.displayTypeMapping();
        this.displayAssociationMapping();
        this.bindSearchableSelectEvents();
        this.switchTab('class-mapping');
        
        this.showAutoAppliedMappingsStats();
    }

    showAutoAppliedMappingsStats() {
        const autoAppliedClasses = this.currentMapping.classMappings.filter(item => item.verified).length;
        const autoAppliedAttributes = this.currentMapping.attributeMappings.filter(item => item.verified).length;
        const autoAppliedTypes = this.currentMapping.typeMappings.filter(item => item.verified).length;
        
        if (autoAppliedClasses > 0 || autoAppliedAttributes > 0 || autoAppliedTypes > 0) {
            this.showSuccess(
                `Автоматически применено сохраненных соответствий: ` +
                `${autoAppliedClasses} классов, ${autoAppliedAttributes} атрибутов, ${autoAppliedTypes} типов`
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
        
        const mapping = defaultMappings[className] || 'IfcProduct';
        // Парсим на случай, если маппинг содержит PredefinedType
        const parsed = this.parseIfcClassName(mapping);
        return parsed.baseClass || mapping;
    }

    getMappedIfcClass(sourceClassName) {
        if (!sourceClassName || !this.currentMapping || !this.currentMapping.classMappings) {
            return null;
        }
        return this.currentMapping.classMappings.find(m => m.source === sourceClassName)?.target || null;
    }

    getDefaultAttributeMapping(attributeName, domainSourceClass = null) {
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
        const property = defaultMappings[attributeName] || attributeName.toUpperCase();
        let propertySet = null;
        const domainClass = domainSourceClass ? this.getMappedIfcClass(domainSourceClass) : null;
        if (domainClass) {
            propertySet = this.findPropertySetForProperty(property, domainClass);
        }
        if (!propertySet) {
            propertySet = this.findPropertySetForProperty(property, null);
        }
        return {
            property,
            propertySet
        };
    }

    getInitialAttributeClassSelection() {
        if (!this.currentMapping || !this.currentMapping.classMappings || this.currentMapping.classMappings.length === 0) {
            return null;
        }

        const classMappings = this.currentMapping.classMappings;
        const attributeDomains = new Set(
            (this.currentMapping.attributeMappings || [])
                .map(attr => attr.domain)
                .filter(Boolean)
        );

        if (attributeDomains.size > 0) {
            const firstMatch = classMappings.find(cls => attributeDomains.has(cls.source));
            if (firstMatch) {
                return firstMatch.source;
            }
        }

        return classMappings[0]?.source || null;
    }

    getDefaultTypeMapping(sourceType) {
        if (!sourceType) return 'String';
        const normalized = sourceType.toLowerCase();

        if (normalized.includes('bool')) return 'Boolean';
        if (normalized.includes('int')) return 'Integer';
        if (normalized.includes('decimal') || normalized.includes('double') || normalized.includes('float') || normalized.includes('real')) return 'Real';
        if (normalized.includes('number')) return 'Number';
        if (normalized.includes('date') && normalized.includes('time')) return 'DateTime';
        if (normalized.includes('date')) return 'Date';
        if (normalized.includes('time')) return 'Time';
        if (normalized.includes('string') || normalized.includes('char') || normalized.includes('text')) return 'String';

        return 'String';
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
            item.setAttribute('data-class-source', mapping.source);
			
			const displayName = mapping.label || this.generateReadableName(mapping.source);
			const savedMapping = this.getSavedMapping('class', mapping.source);
			const usageInfo = savedMapping ? ` (использовано ${savedMapping.usageCount} раз)` : '';
			
			const ifcClasses = this.getIfcClasses();
			// Для классов запрещаем произвольные значения — только из схемы
			
			// Получаем доступные PredefinedType для выбранного класса
			const predefinedTypes = this.getPredefinedTypesForClass(mapping.target);
			const currentPredefinedType = mapping.predefinedType || '';
			
			const isSelected = mapping.source === this.selectedClassForAttributes;
            if (isSelected) {
                item.classList.add('selected-class');
            }

			item.innerHTML = `
				<div class="source-item">
					<div class="element-name">${displayName}</div>
					<div class="element-technical">${mapping.source}${usageInfo}</div>
				</div>
				<div class="target-item attribute-target">
					<div class="class-mapping-container">
						<div class="searchable-select" data-index="${index}" data-type="class">
							<div class="selected-value">${mapping.target || '-- Выберите IFC класс --'}</div>
							<div class="dropdown">
								<input type="text" class="search-input" placeholder="Поиск IFC класса...">
								<div class="options-list">
									${ifcClasses.map(cls => 
										`<div class="option ${cls === mapping.target ? 'selected' : ''}" data-value="${cls}">${cls}</div>`
									).join('')}
								</div>
							</div>
						</div>
						<input type="text" class="mapping-input" 
							   style="display: none;"
							   value="" 
							   placeholder="Введите IFC класс">
						${predefinedTypes.length > 0 ? `
							<select class="predefined-type-select" data-index="${index}" data-type="predefinedType">
								<option value="">-- Не указывать PredefinedType --</option>
								${predefinedTypes.map(type => 
									`<option value="${type}" ${type === currentPredefinedType ? 'selected' : ''}>${type}</option>`
								).join('')}
							</select>
						` : ''}
					</div>
				</div>
				<div class="verified-item">
					<input type="checkbox" class="verified-checkbox" data-index="${index}" data-type="class" 
						   ${mapping.verified ? 'checked' : ''}>
					<span class="verified-label">${mapping.verified ? '✓' : '✗'}</span>
				</div>
			`;
			item.addEventListener('click', (event) => this.handleClassSelection(event, mapping.source));

            container.appendChild(item);
		});

		this.bindMappingEvents('class');
		this.bindPredefinedTypeEvents();
        this.bindSearchableSelectEvents();
        this.updateClassSelectionHighlight();
	}

    handleClassSelection(event, className) {
        if (
            event.target.closest('.searchable-select') ||
            event.target.closest('.verified-item') ||
            event.target.closest('.predefined-type-select')
        ) {
            return;
        }
        this.selectClassForAttributes(className);
    }

    selectClassForAttributes(className) {
        if (!className || this.selectedClassForAttributes === className) {
            return;
        }
        this.selectedClassForAttributes = className;
        this.updateClassSelectionHighlight();
        this.displayAttributeMapping();
    }

    updateClassSelectionHighlight() {
        const container = document.getElementById('classMappingList');
        if (!container) return;
        const items = container.querySelectorAll('.mapping-item');
        items.forEach(item => {
            if (item.getAttribute('data-class-source') === this.selectedClassForAttributes) {
                item.classList.add('selected-class');
            } else {
                item.classList.remove('selected-class');
            }
        });
    }

	displayAttributeMapping() {
		const container = document.getElementById('attributeMappingList');
        const breadcrumb = document.getElementById('attributeBreadcrumb');
        if (!container || !breadcrumb) return;

		container.innerHTML = '';
        this.applyAttributePanelHeight();
        this.bindAttributeResizer();

        if (!this.currentMapping) {
            breadcrumb.textContent = 'Классы › Атрибуты отсутствуют';
			container.innerHTML = '<div class="no-mappings">Атрибуты не найдены в исходной модели</div>';
			return;
		}

        const attributeMappings = this.currentMapping.attributeMappings || [];

        if (attributeMappings.length === 0) {
            breadcrumb.textContent = 'Классы › Атрибуты отсутствуют';
			container.innerHTML = '<div class="no-mappings">Атрибуты не найдены в исходной модели</div>';
			return;
        }

        if (!this.selectedClassForAttributes) {
            breadcrumb.innerHTML = 'Классы › <span>Выберите класс</span>';
            container.innerHTML = '<div class="no-mappings">Выберите класс, чтобы увидеть его атрибуты</div>';
            return;
        }

        const currentClass = this.currentMapping.classMappings.find(m => m.source === this.selectedClassForAttributes);
        const classLabel = currentClass ? (currentClass.label || this.generateReadableName(currentClass.source)) : this.selectedClassForAttributes;
        breadcrumb.innerHTML = `Классы › <span>${classLabel}</span> › Атрибуты`;

        const domainKey = this.selectedClassForAttributes || '__NO_DOMAIN__';
        const domainAttributes = this.attributesByDomain.get(domainKey);

        if (!domainAttributes || domainAttributes.length === 0) {
            container.innerHTML = `<div class="no-mappings">Для класса "${classLabel}" атрибуты не найдены</div>`;
            return;
        }

		domainAttributes.forEach(({ mapping, index }) => {
			const item = document.createElement('div');
			item.className = 'mapping-item';
			
			const displayName = mapping.label || this.generateReadableName(mapping.source);
			const savedMapping = this.getSavedMapping('attribute', mapping.source);
			const usageInfo = savedMapping ? ` (использовано ${savedMapping.usageCount} раз)` : '';

            const domainClassTarget = this.getMappedIfcClass(mapping.domain) || (currentClass ? currentClass.target : null);
            const selectorData = this.getPropertySelectorData(mapping, domainClassTarget);
            const propertySetLabel = selectorData.propertySetLabel;
            const propertyLabel = selectorData.propertyLabel;
            const isCustomValue = selectorData.isCustomValue;
			
			item.innerHTML = `
				<div class="source-item">
					<div class="element-name">${displayName}</div>
					<div class="element-technical">${mapping.source}${usageInfo}</div>
				</div>
				<div class="target-item association-target-item">
                    <div class="association-target-controls">
                        <div class="property-selectors-row">
                            <div class="property-selector-group">
                                <div class="property-selector-label">PropertySet</div>
                                <div class="searchable-select" data-index="${index}" data-type="attribute-propertyset">
                                    <div class="selected-value">${this.escapeHtml(propertySetLabel)}</div>
                                    <div class="dropdown">
                                        <input type="text" class="search-input" placeholder="Поиск PropertySet...">
                                        <div class="options-list">
                                            ${selectorData.propertySetOptions}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="property-selector-group">
                                <div class="property-selector-label">IFC Свойство</div>
                                <div class="searchable-select" data-index="${index}" data-type="attribute">
                                    <div class="selected-value">${this.escapeHtml(propertyLabel)}</div>
                                    <div class="dropdown">
                                        <input type="text" class="search-input" placeholder="Поиск свойства...">
                                        <div class="options-list">
                                            ${selectorData.propertyOptions}
                                        </div>
                                    </div>
                                </div>
                                <input type="text" class="mapping-input" 
                                       style="display: ${isCustomValue ? 'block' : 'none'};"
                                       value="${isCustomValue ? this.escapeHtml(mapping.target || '') : ''}" 
                                       placeholder="Введите IFC атрибут">
                            </div>
                        </div>
                    </div>
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

    displayTypeMapping() {
        const container = document.getElementById('typeMappingList');
        container.innerHTML = '';

        if (!this.currentMapping.typeMappings || this.currentMapping.typeMappings.length === 0) {
            container.innerHTML = '<div class="no-mappings">Типы данных не найдены в исходной модели</div>';
            return;
        }

        const ifcDataTypes = this.getIfcDataTypes();

        this.currentMapping.typeMappings.forEach((mapping, index) => {
            const item = document.createElement('div');
            item.className = 'mapping-item';

            const savedMapping = this.getSavedMapping('type', mapping.source);
            const usageInfo = savedMapping ? ` (использовано ${savedMapping.usageCount} раз)` : '';

            item.innerHTML = `
                <div class="source-item">
                    <div class="element-name">${mapping.label || mapping.source}</div>
                    <div class="element-technical">${mapping.source}${usageInfo}</div>
                </div>
                <div class="target-item">
                    <div class="searchable-select" data-index="${index}" data-type="type">
                        <div class="selected-value">${mapping.target || '-- Выберите тип --'}</div>
                        <div class="dropdown">
                            <input type="text" class="search-input" placeholder="Поиск простого IFC типа...">
                            <div class="options-list">
                                ${ifcDataTypes.map(type => 
                                    `<div class="option ${type === mapping.target ? 'selected' : ''}" data-value="${type}">${type}</div>`
                                ).join('')}
                            </div>
                        </div>
                    </div>
                    <input type="text" class="mapping-input" 
                           style="display: none;"
                           value="" 
                           placeholder="Введите IFC тип данных">
                </div>
                <div class="verified-item">
                    <input type="checkbox" class="verified-checkbox" data-index="${index}" data-type="type" 
                           ${mapping.verified ? 'checked' : ''}>
                    <span class="verified-label">${mapping.verified ? '✓' : '✗'}</span>
                </div>
            `;

            container.appendChild(item);
        });

        this.bindMappingEvents('type');
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
            item.setAttribute('data-association-index', index);
			
			const displayName = mapping.label || this.generateReadableName(mapping.source);
			const savedMapping = this.getSavedMapping('association', mapping.source);
			const usageInfo = savedMapping ? ` (использовано ${savedMapping.usageCount} раз)` : '';
			
			const domainClass = this.getMappedIfcClass(mapping.domain);

            if (!mapping.propertySet && mapping.target) {
                const guessedSet = this.findPropertySetForProperty(mapping.target, domainClass);
                if (guessedSet) {
                    mapping.propertySet = guessedSet;
                }
            }

            const selectorData = this.getPropertySelectorData(mapping, domainClass, { excludePropertySets: ['Attributes'] });
            const propertySetLabel = selectorData.propertySetLabel;
            const propertyLabel = selectorData.propertyLabel;
            const isCustomValue = selectorData.isCustomValue;
			
			item.innerHTML = `
				<div class="source-item">
					<div class="element-name">${displayName}</div>
					<div class="element-technical">${mapping.source}${usageInfo}</div>
					<div class="association-source-target">
						${mapping.domain ? `Домен: ${mapping.domain}` : ''} 
						${mapping.range ? '→ ' + mapping.range : ''}
						${mapping.cardinality ? ` (${mapping.cardinality})` : ''}
						${domainClass ? ` [IFC: ${domainClass}]` : ''}
                        ${mapping.propertySet ? ` | PropertySet: ${mapping.propertySet}` : ''}
					</div>
				</div>
				<div class="target-item association-target-item">
                    <div class="association-target-controls">
                        <div class="property-selectors-row">
                            <div class="property-selector-group">
                                <div class="property-selector-label">PropertySet</div>
                                <div class="searchable-select" data-index="${index}" data-type="association-propertyset">
                                    <div class="selected-value">${this.escapeHtml(propertySetLabel)}</div>
                                    <div class="dropdown">
                                        <input type="text" class="search-input" placeholder="Поиск PropertySet...">
                                        <div class="options-list">
                                            ${selectorData.propertySetOptions}
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="property-selector-group">
                                <div class="property-selector-label">IFC Свойство</div>
                                <div class="searchable-select" data-index="${index}" data-type="association">
                                    <div class="selected-value">${this.escapeHtml(propertyLabel)}</div>
                                    <div class="dropdown">
                                        <input type="text" class="search-input" placeholder="Поиск свойства...">
                                        <div class="options-list">
                                            ${selectorData.propertyOptions}
                                        </div>
                                    </div>
                                </div>
                                <input type="text" class="mapping-input" 
                                       style="display: ${isCustomValue ? 'block' : 'none'};"
                                       value="${isCustomValue ? this.escapeHtml(mapping.target) : ''}" 
                                       placeholder="Введите IFC свойство">
                            </div>
                        </div>
                    </div>
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
        let property = null;
        let propertySet = null;

        if (domain) {
            const domainClass = this.currentMapping.classMappings.find(m => m.source === domain)?.target;
            if (domainClass) {
                const classProperties = this.getIfcClassProperties(domainClass);
                if (classProperties.length > 0) {
                    const lowerName = associationName.toLowerCase();
                    for (const prop of classProperties) {
                        if (prop.toLowerCase().includes(lowerName) || lowerName.includes(prop.toLowerCase())) {
                            property = prop;
                            break;
                        }
                    }
                    if (!property) {
                        property = classProperties[0];
                    }
                    propertySet = this.findPropertySetForProperty(property, domainClass);
                    if (propertySet === 'Attributes') {
                        propertySet = null;
                    }
                    return { property, propertySet };
                }
            }
        }

        property = this.getAllIfcProperties()[0] || 'Name';
        propertySet = this.findPropertySetForProperty(property, null);
        if (propertySet === 'Attributes') {
            propertySet = null;
        }
        return { property, propertySet };
    }

    // Новый метод для привязки событий к улучшенным селектам
    bindSearchableSelectEvents() {
        // Глобальный обработчик закрытия селектов добавляем один раз
        if (!this.searchableSelectGlobalHandler) {
            this.searchableSelectGlobalHandler = (e) => {
                if (!e.target.closest('.searchable-select')) {
                    document.querySelectorAll('.searchable-select').forEach(select => {
                        select.classList.remove('open');
                    });
                }
            };
            document.addEventListener('click', this.searchableSelectGlobalHandler);
        }

        document.querySelectorAll('.searchable-select').forEach(select => {
            if (select.dataset.enhanced === 'true') {
                return;
            }
            select.dataset.enhanced = 'true';

            const selectedValue = select.querySelector('.selected-value');
            if (selectedValue) {
                selectedValue.addEventListener('click', (e) => {
                    const isOpen = select.classList.contains('open');
                    
                    document.querySelectorAll('.searchable-select').forEach(s => {
                        if (s !== select) {
                            s.classList.remove('open');
                        }
                    });
                    
                    select.classList.toggle('open');
                    
                    if (!isOpen) {
                        const searchInput = select.querySelector('.search-input');
                        if (searchInput) {
                            setTimeout(() => searchInput.focus(), 100);
                        }
                    }
                    e.stopPropagation();
                });
            }

            const searchInput = select.querySelector('.search-input');
            if (searchInput) {
                searchInput.addEventListener('input', (e) => {
                    const searchTerm = e.target.value.toLowerCase();
                    const options = select.querySelectorAll('.option');
                    
                    options.forEach(option => {
                        const text = option.textContent.toLowerCase();
                        if (text.includes(searchTerm) || option.classList.contains('option-group')) {
                            option.style.display = '';
                        } else {
                            option.style.display = 'none';
                        }
                    });
                });

                searchInput.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }

            select.querySelectorAll('.option').forEach(option => {
                option.addEventListener('click', (e) => {
                    if (option.dataset.disabled === 'true') {
                        return;
                    }
                    const value = option.getAttribute('data-value');
                    const index = parseInt(select.getAttribute('data-index'));
                    const type = select.getAttribute('data-type');

                    if (value === '__create_property_set__') {
                        e.stopPropagation();
                        this.handleCreatePropertySetSelection(type, index);
                        select.classList.remove('open');
                        return;
                    }

                    if (value === '__add_property__') {
                        e.stopPropagation();
                        this.handleAddPropertyOptionSelection(type, index);
                        select.classList.remove('open');
                        return;
                    }

                    e.stopPropagation();
                    
                    select.querySelectorAll('.option').forEach(opt => {
                        opt.classList.remove('selected');
                    });
                    option.classList.add('selected');
                    
                    if (selectedValue) {
                        const customDisplay = option.getAttribute('data-display');
                        if (value === 'custom') {
                            selectedValue.textContent = '-- Другое --';
                        } else if (customDisplay) {
                            selectedValue.textContent = customDisplay;
                        } else if (value) {
                            selectedValue.textContent = value;
                        } else {
                            selectedValue.textContent = '-- Не выбрано --';
                        }
                    }
                    
                    select.classList.remove('open');
                    
                    const input = select.parentNode ? select.parentNode.querySelector('.mapping-input') : null;

                    if (type === 'association-propertyset') {
                        this.updateMappingPropertySet(type, index, value);
                        return;
                    }

                    if (type === 'attribute-propertyset') {
                        this.updateMappingPropertySet(type, index, value);
                        return;
                    }
                    
                    if (value === 'custom') {
                        if (input) {
                            input.style.display = 'block';
                            input.focus();
                            const newValue = input.value || '';
                            this.updateMapping(type, index, newValue);
                        }
                    } else {
                        if (input) {
                            input.style.display = 'none';
                            input.value = '';
                        }
                        this.updateMapping(type, index, value);
                        
                        if (type === 'class') {
                            this.updatePredefinedTypeDropdown(index, value);
                        }
                        
                        if (type === 'association' && value) {
                            const mapping = this.currentMapping.associationMappings[index];
                            if (mapping && mapping.domain) {
                                const domainClass = this.currentMapping.classMappings.find(m => m.source === mapping.domain)?.target;
                                if (domainClass) {
                                    const classProperties = this.getIfcClassProperties(domainClass);
                                    if (!classProperties.includes(value)) {
                                        const propertySet = mapping.propertySet || 'Pset_Custom';
                                        this.addCustomPropertyToClass(domainClass, value, propertySet);
                                    }
                                }
                            }
                        }
                    }
                });
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
        } else if (type === 'type') {
            container = document.getElementById('typeMappingList');
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

    getMappingEntry(type, index) {
        if (!this.currentMapping) return null;
        if (type === 'association' || type === 'association-propertyset') {
            return this.currentMapping.associationMappings?.[index] || null;
        }
        if (type === 'attribute' || type === 'attribute-propertyset') {
            return this.currentMapping.attributeMappings?.[index] || null;
        }
        if (type === 'class') {
            return this.currentMapping.classMappings?.[index] || null;
        }
        if (type === 'type') {
            return this.currentMapping.typeMappings?.[index] || null;
        }
        return null;
    }

    handleCreatePropertySetSelection(selectType, index) {
        const newSet = this.promptCreatePropertySet();
        if (newSet) {
            this.updateMappingPropertySet(selectType, index, newSet);
        } else {
            if (selectType.startsWith('association')) {
                this.displayAssociationMapping();
            } else if (selectType.startsWith('attribute')) {
                this.displayAttributeMapping();
            }
        }
    }

    handleAddPropertyOptionSelection(type, index) {
        const mapping = this.getMappingEntry(type, index);
        if (!mapping) return;
        if (!mapping.propertySet) {
            this.showError('Сначала выберите PropertySet');
            return;
        }
        if (!this.isCustomPropertySet(mapping.propertySet)) {
            this.showError('Добавлять свойства можно только в пользовательские PropertySet');
            return;
        }
        const newProperty = this.promptAddPropertyToCustomSet(mapping.propertySet);
        if (newProperty) {
            mapping.target = newProperty;
            mapping.verified = false;
            if (type === 'association') {
                this.displayAssociationMapping();
            } else if (type === 'attribute') {
                this.displayAttributeMapping();
            }
        }
    }

    updateMappingPropertySet(selectType, index, propertySetValue) {
        const targetType = selectType.startsWith('association') ? 'association' : 'attribute';
        const mapping = this.getMappingEntry(targetType, index);
        if (!mapping) return;

        const normalizedValue = propertySetValue || null;
        if (mapping.propertySet === normalizedValue) {
            if (targetType === 'association') {
                this.displayAssociationMapping();
            } else {
                this.displayAttributeMapping();
            }
            return;
        }

        mapping.propertySet = normalizedValue;
        if (!normalizedValue) {
            mapping.target = null;
        } else {
            const domainClass = this.getMappedIfcClass(mapping.domain);
            const availableProperties = this.getPropertiesForPropertySet(normalizedValue, domainClass);
            if (!availableProperties.includes(mapping.target)) {
                mapping.target = null;
            }
        }

        if (mapping.verified) {
            mapping.verified = false;
            const checkbox = document.querySelector(`.verified-checkbox[data-type="${targetType}"][data-index="${index}"]`);
            if (checkbox) {
                checkbox.checked = false;
                const label = checkbox.nextElementSibling;
                if (label) label.textContent = '✗';
            }
            this.showInfo('Значение изменено. Подтвердите соответствие заново.');
        }

        if (targetType === 'association') {
            this.displayAssociationMapping();
        } else {
            this.displayAttributeMapping();
        }
    }

    updateMapping(type, index, value) {
        console.log(`Updating ${type} mapping at index ${index} to: ${value}`);
        
		// Унифицированная функция сброса подтверждения
		const revokeVerificationIfChanged = (collection, idx, newValue) => {
			const item = collection && collection[idx];
			if (!item) return;

			const prevValue = item.target;
			const changed = prevValue !== newValue;
			item.target = newValue;

			// Если значение изменилось и было подтверждено — автоматически снимаем подтверждение
			if (changed && item.verified) {
				item.verified = false;
				// Снимаем чекбокс и меняем метку в UI
				const checkbox = document.querySelector(`.verified-checkbox[data-type="${type}"][data-index="${idx}"]`);
				if (checkbox) {
					checkbox.checked = false;
					const label = checkbox.nextElementSibling;
					if (label) label.textContent = '✗';
				}
				this.showInfo('Значение изменено. Подтвердите соответствие заново.');
			}
		};

		if (type === 'class') {
			revokeVerificationIfChanged(this.currentMapping.classMappings, index, value);
			// Очищаем PredefinedType при изменении базового класса
			if (this.currentMapping.classMappings[index]) {
				const predefinedTypes = this.getPredefinedTypesForClass(value);
				if (!predefinedTypes.includes(this.currentMapping.classMappings[index].predefinedType)) {
					this.currentMapping.classMappings[index].predefinedType = null;
				}
			}
		} else if (type === 'attribute') {
			revokeVerificationIfChanged(this.currentMapping.attributeMappings, index, value);
		} else if (type === 'association') {
			revokeVerificationIfChanged(this.currentMapping.associationMappings, index, value);
        } else if (type === 'type') {
            revokeVerificationIfChanged(this.currentMapping.typeMappings, index, value);
		}
    }
    
    // Обновление выпадающего списка PredefinedType при изменении класса
    updatePredefinedTypeDropdown(index, baseClass) {
        // Находим элемент по data-index атрибуту в searchable-select
        const selectElement = document.querySelector(`.searchable-select[data-index="${index}"][data-type="class"]`);
        if (!selectElement) return;
        
        const mappingItem = selectElement.closest('.mapping-item');
        if (!mappingItem) return;
        
        const targetItem = mappingItem.querySelector('.target-item');
        if (!targetItem) return;
        
        const predefinedTypes = this.getPredefinedTypesForClass(baseClass);
        const currentPredefinedType = this.currentMapping.classMappings[index]?.predefinedType || '';
        const existingSelect = targetItem.querySelector('.predefined-type-select');
        
        if (predefinedTypes.length > 0) {
            if (existingSelect) {
                // Обновляем существующий список
                existingSelect.innerHTML = `
                    <option value="">-- Не указывать PredefinedType --</option>
                    ${predefinedTypes.map(type => 
                        `<option value="${type}" ${type === currentPredefinedType ? 'selected' : ''}>${type}</option>`
                    ).join('')}
                `;
            } else {
                // Создаем новый список
                const container = targetItem.querySelector('.class-mapping-container');
                if (!container) return;
                
                const select = document.createElement('select');
                select.className = 'predefined-type-select';
                select.setAttribute('data-index', index);
                select.setAttribute('data-type', 'predefinedType');
                select.innerHTML = `
                    <option value="">-- Не указывать PredefinedType --</option>
                    ${predefinedTypes.map(type => 
                        `<option value="${type}" ${type === currentPredefinedType ? 'selected' : ''}>${type}</option>`
                    ).join('')}
                `;
                container.appendChild(select);
                this.bindPredefinedTypeEvents();
            }
        } else {
            // Удаляем список, если PredefinedType не поддерживаются
            if (existingSelect) {
                existingSelect.remove();
            }
        }
    }
    
    // Привязка обработчиков для выпадающего списка PredefinedType
    bindPredefinedTypeEvents() {
        document.querySelectorAll('.predefined-type-select').forEach(select => {
            // Удаляем старые обработчики
            const newSelect = select.cloneNode(true);
            select.parentNode.replaceChild(newSelect, select);
            
            // Добавляем новый обработчик
            newSelect.addEventListener('change', (e) => {
                const index = parseInt(e.target.getAttribute('data-index'));
                const predefinedType = e.target.value || null;
                
                if (this.currentMapping && this.currentMapping.classMappings[index]) {
                    this.currentMapping.classMappings[index].predefinedType = predefinedType;
                    
                    // Снимаем подтверждение при изменении PredefinedType
                    if (this.currentMapping.classMappings[index].verified) {
                        this.currentMapping.classMappings[index].verified = false;
                        const checkbox = document.querySelector(`.verified-checkbox[data-type="class"][data-index="${index}"]`);
                        if (checkbox) {
                            checkbox.checked = false;
                            const label = checkbox.nextElementSibling;
                            if (label) label.textContent = '✗';
                        }
                        this.showInfo('Значение изменено. Подтвердите соответствие заново.');
                    }
                }
            });
        });
    }

    updateVerificationStatus(type, index, isVerified) {
        console.log(`Updating ${type} verification at index ${index} to: ${isVerified}`);
        
        if (type === 'class') {
            if (this.currentMapping.classMappings[index]) {
                this.currentMapping.classMappings[index].verified = isVerified;
                
                if (isVerified) {
                    const mapping = this.currentMapping.classMappings[index];
                    this.addVerifiedMapping('class', mapping.source, mapping.target, { predefinedType: mapping.predefinedType || null });
                }
            }
        } else if (type === 'attribute') {
            if (this.currentMapping.attributeMappings[index]) {
                this.currentMapping.attributeMappings[index].verified = isVerified;
                
                if (isVerified) {
                    const mapping = this.currentMapping.attributeMappings[index];
                    this.addVerifiedMapping('attribute', mapping.source, mapping.target, { propertySet: mapping.propertySet || null });
                    if (mapping.domain && mapping.target) {
                        const domainClass = this.getMappedIfcClass(mapping.domain);
                        if (domainClass) {
                            const classProperties = this.getIfcClassProperties(domainClass);
                            if (!classProperties.includes(mapping.target)) {
                                const propertySet = mapping.propertySet || 'Pset_Custom';
                                this.addCustomPropertyToClass(domainClass, mapping.target, propertySet);
                            }
                        }
                    }
                }
            }
        } else if (type === 'association') {
            if (this.currentMapping.associationMappings && this.currentMapping.associationMappings[index]) {
                this.currentMapping.associationMappings[index].verified = isVerified;
                
                if (isVerified) {
                    const mapping = this.currentMapping.associationMappings[index];
                    this.addVerifiedMapping('association', mapping.source, mapping.target, { propertySet: mapping.propertySet || null });
                    
                    // Если это ObjectProperty и свойство не существует в схеме, добавляем его
                    if (mapping.domain && mapping.target) {
                        const domainClass = this.currentMapping.classMappings.find(m => m.source === mapping.domain)?.target;
                        if (domainClass) {
                            const classProperties = this.getIfcClassProperties(domainClass);
                            if (!classProperties.includes(mapping.target)) {
                                const propertySet = mapping.propertySet || 'Pset_Custom';
                                this.addCustomPropertyToClass(domainClass, mapping.target, propertySet);
                            }
                        }
                    }
                }
            }
        } else if (type === 'type') {
            if (this.currentMapping.typeMappings && this.currentMapping.typeMappings[index]) {
                this.currentMapping.typeMappings[index].verified = isVerified;

                if (isVerified) {
                    const mapping = this.currentMapping.typeMappings[index];
                    this.addVerifiedMapping('type', mapping.source, mapping.target);
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

        mappingText += "\nСОПОСТАВЛЕНИЕ ТИПОВ:\n";
        mappingText += "--------------------\n";
        if (this.currentMapping.typeMappings && this.currentMapping.typeMappings.length > 0) {
            this.currentMapping.typeMappings.forEach((item, index) => {
                const status = item.verified ? '✓ ПОДТВЕРЖДЕНО' : '✗ НЕПОДТВЕРЖДЕНО';
                mappingText += `${index + 1}. ${item.source} → ${item.target} [${status}]\n`;
            });
        } else {
            mappingText += "Типы данных не найдены\n";
        }
        
        mappingText += "\nСОПОСТАВЛЕНИЕ АССОЦИАЦИЙ:\n";
        mappingText += "-------------------------\n";
        if (this.currentMapping.associationMappings && this.currentMapping.associationMappings.length > 0) {
            this.currentMapping.associationMappings.forEach((item, index) => {
                const displayName = item.label || this.generateReadableName(item.source);
                const status = item.verified ? '✓ ПОДТВЕРЖДЕНО' : '✗ НЕПОДТВЕРЖДЕНО';
                const domainRange = item.domain && item.range ? ` (${item.domain} → ${item.range})` : '';
                const propertySetInfo = item.propertySet ? ` [PropertySet: ${item.propertySet}]` : '';
                const targetValue = item.target || '-- не выбрано --';
                mappingText += `${index + 1}. ${displayName}${domainRange} (${item.source}) → ${targetValue} [${status}]${propertySetInfo}\n`;
            });
        } else {
            mappingText += "Ассоциации не найдены\n";
        }
        
        mappingText += `\nВсего классов: ${this.currentMapping.classMappings.length}`;
        mappingText += `\nВсего атрибутов: ${this.currentMapping.attributeMappings.length}`;
        mappingText += `\nВсего типов: ${this.currentMapping.typeMappings.length}`;
        
        const verifiedClasses = this.currentMapping.classMappings.filter(item => item.verified).length;
        const verifiedAttributes = this.currentMapping.attributeMappings.filter(item => item.verified).length;
        const verifiedTypes = this.currentMapping.typeMappings.filter(item => item.verified).length;
        mappingText += `\nПодтверждено классов: ${verifiedClasses}/${this.currentMapping.classMappings.length}`;
        mappingText += `\nПодтверждено атрибутов: ${verifiedAttributes}/${this.currentMapping.attributeMappings.length}`;
        mappingText += `\nПодтверждено типов: ${verifiedTypes}/${this.currentMapping.typeMappings.length}`;
        
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

    showPropertySetModal() {
        const modal = document.getElementById('propertySetModal');
        if (!modal) return;
        modal.style.display = 'block';
        this.renderPropertySetModal();
    }

    hidePropertySetModal() {
        const modal = document.getElementById('propertySetModal');
        if (!modal) return;
        modal.style.display = 'none';
    }

    renderPropertySetModal() {
        const list = document.getElementById('customPropertySetList');
        if (!list) return;
        const customSets = this.customPropertySets || {};
        const names = Object.keys(customSets);

        if (names.length === 0) {
            list.innerHTML = '<div class="no-items">Пользовательские PropertySet отсутствуют</div>';
            return;
        }

        names.sort((a, b) => a.localeCompare(b));
        list.innerHTML = names.map(name => {
            const props = customSets[name] || [];
            const propertiesHtml = props.length > 0
                ? props.map(prop => `
                    <span class="propertyset-property-chip">
                        ${this.escapeHtml(prop)}
                        <button class="propertyset-chip-remove" data-action="remove-property" data-set="${this.escapeHtml(name)}" data-property="${this.escapeHtml(prop)}">&times;</button>
                    </span>
                `).join('')
                : '<div class="propertyset-empty">Свойства отсутствуют</div>';

            return `
                <div class="propertyset-item">
                    <div class="propertyset-item-header">
                        <div class="propertyset-item-title">${this.escapeHtml(name)}</div>
                        <div class="propertyset-item-actions">
                            <button class="save-button" data-action="add-property" data-set="${this.escapeHtml(name)}">Добавить свойство</button>
                            <button class="cancel-button" data-action="remove-set" data-set="${this.escapeHtml(name)}">Удалить PropertySet</button>
                        </div>
                    </div>
                    <div class="propertyset-properties">
                        ${propertiesHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    validateMapping() {
        if (!this.currentMapping) {
            this.showError('Сначала создайте соответствия для проверки');
            return;
        }

		const sourceHierarchy = this.extractSourceHierarchy();
		if (!sourceHierarchy || Object.keys(sourceHierarchy).length === 0) {
			// Нет подчиненности в исходной модели — это допустимо, просто нечего проверять
			this.showInfo('В исходной модели не найдено rdfs:subClassOf. Проверка иерархий пропущена.');
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
		let sourceType = document.getElementById('sourceType').value;
		
		// Авто-определение, если пользователь не выбрал корректно
		if (!sourceType || sourceType === 'auto' || sourceType === 'text') {
			if (sourceCode.includes('@prefix') || sourceCode.includes('PREFIX')) {
				sourceType = 'owl';
			} else if (sourceCode.includes('<?xml') && sourceCode.includes('rdf:RDF')) {
				sourceType = 'rdf';
			}
		}

		console.log('Тип исходной модели для извлечения иерархии:', sourceType);
        
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
			const parents = (hierarchies.parents && hierarchies.parents[currentClass]) ? hierarchies.parents[currentClass] : [];
			
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
			const parents = (hierarchies.parents && hierarchies.parents[currentClass]) ? hierarchies.parents[currentClass] : [];
			
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

		// Подготовим множество валидных IFC классов для строгой проверки
		const validIfcClasses = new Set(this.getIfcClasses());
		
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

				// Явная проверка существования целевых IFC классов
				if (!validIfcClasses.has(childMapping.target) || !validIfcClasses.has(parentMapping.target)) {
					const missingTargets = [
						!validIfcClasses.has(childMapping.target) ? childMapping.target : null,
						!validIfcClasses.has(parentMapping.target) ? parentMapping.target : null
					].filter(Boolean).join(', ');

					errors.push({
						childClass,
						parentClass,
						childMapping: childMapping.target,
						parentMapping: parentMapping.target,
						errorType: 'неизвестный IFC класс',
						message: `Целевой класс(ы) IFC отсутствуют в схеме: ${missingTargets}`
					});
					continue;
				}

				// Проверяем соответствие иерархии
				const isValid = this.validateHierarchyMapping(
					childMapping.target, 
					parentMapping.target,
					childClass,
					parentClass
				);
				
				if (!isValid) {
					// Проверяем только два случая: обратная иерархия и обобщение дочернего
					const hierarchies = this.getIfcHierarchies();
					const childIsAncestorOfParent = this.isIfcAncestor(childMapping.target, parentMapping.target, hierarchies);
					const parentIsAncestorOfChild = this.isIfcAncestor(parentMapping.target, childMapping.target, hierarchies);

					let errorType = null;
					if (childIsAncestorOfParent && !parentIsAncestorOfChild) {
						errorType = 'обобщение дочернего класса';
					} else if (!childIsAncestorOfParent && parentIsAncestorOfChild) {
						errorType = 'обратная иерархия';
					}

					// Несвязанные ветви и прочие случаи игнорируем
					if (errorType) {
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
		}
		
		console.log(`Всего найдено ошибок: ${errors.length}`);
		return errors;
	}

	// Сообщение об ошибке иерархии
	getHierarchyErrorMessage(errorType, childClass, parentClass, childIfc, parentIfc) {
		if (errorType === 'обратная иерархия') {
			return `Обратная иерархия: OWL ${childClass} → ${parentClass}, но IFC ${childIfc} → ${parentIfc} нарушает порядок (родитель и потомок перепутаны)`;
		}
		if (errorType === 'обобщение дочернего класса') {
			return `Дочерний OWL-класс отмапплен в более общий IFC-класс, чем родительский: OWL ${childClass} → ${parentClass}, IFC ${childIfc} (предок) → ${parentIfc}`;
		}
		if (errorType === 'несвязанная иерархия') {
			return `Несвязанные ветви IFC: для OWL ${childClass} → ${parentClass} выбранные IFC классы (${childIfc} и ${parentIfc}) не состоят в отношении предок/потомок`;
		}
		if (errorType === 'неоднозначная иерархия') {
			return `Неоднозначная иерархия: обнаружено взаимное отношение предок/потомок между IFC ${childIfc} и ${parentIfc}`;
		}
		return `Нарушение иерархии: OWL ${childClass} → ${parentClass}, но в IFC класс ${parentIfc} не является предком ${childIfc}`;
	}

	// Возвращает путь иерархии IFC от класса вверх по первым родителям
	getIfcClassHierarchyPath(ifcClass) {
		const hierarchies = this.getIfcHierarchies();
		const path = [ifcClass];
		const visited = new Set([ifcClass]);
		let current = ifcClass;

		while (hierarchies.parents && hierarchies.parents[current] && hierarchies.parents[current].length > 0) {
			// Берём первого родителя как основной путь
			const parent = hierarchies.parents[current][0];
			if (!parent || visited.has(parent)) break;
			path.push(parent);
			visited.add(parent);
			current = parent;
		}
		return path;
	}

	// Улучшенное извлечение иерархии из OWL Turtle
	extractOwlHierarchy(turtleCode) {
		// Нормализуем неразрывные пробелы и CRLF
		turtleCode = turtleCode.replace(/\u00A0/g, ' ').replace(/\r\n/g, '\n');
		const hierarchy = {};

		// Нормализуем окончания выражений, разбиваем на блоки по точке в конце тройки/блока
		const blocks = [];
		let buffer = '';
		for (const rawLine of turtleCode.split('\n')) {
			const line = rawLine.trim();
			if (!line || line.startsWith('#')) continue;
			buffer += (buffer ? ' ' : '') + line;
			if (line.endsWith('.')) {
				blocks.push(buffer);
				buffer = '';
			}
		}
		if (buffer) blocks.push(buffer);
		console.log('OWL: количество блоков для парсинга:', blocks.length);

		// Вспомогательная функция: извлечь локальное имя из QName или IRI
		const toLocalName = (token) => {
			if (!token) return null;
			// Удаляем завершающую точку и точку с запятой
			let t = token.replace(/[.;]$/, '');
			// Если токен в угловых скобках <...>, извлекаем фрагмент после # или последний сегмент после /
			const iriMatch = t.match(/^<([^>]+)>$/);
			if (iriMatch) {
				const iri = iriMatch[1];
				const hashIdx = iri.lastIndexOf('#');
				if (hashIdx >= 0 && hashIdx < iri.length - 1) return iri.substring(hashIdx + 1);
				const slashIdx = iri.lastIndexOf('/');
				if (slashIdx >= 0 && slashIdx < iri.length - 1) return iri.substring(slashIdx + 1);
				return iri; // fallback
			}
			// QName: prefix:Local or :Local
			const qnameMatch = t.match(/^([A-Za-z_][\w-]*:)?([\w-]+)$/);
			if (qnameMatch) return qnameMatch[2];
			return null;
		};

		// Обрабатываем каждый блок; ищем субъект класса и его rdfs:subClassOf
		blocks.forEach(block => {
			// 0) Явный кейс: "ex:Child a owl:Class ; rdfs:subClassOf ex:Parent ;"
			const explicitInline = block.match(/^\s*([A-Za-z_][\w-]*:[\w-]+|:[\w-]+)\s+a\s+owl:Class\s*;\s*rdfs:subClassOf\s+([A-Za-z_][\w-]*:[\w-]+|:[\w-]+)/);
			if (explicitInline) {
				const child = toLocalName(explicitInline[1]);
				const parent = toLocalName(explicitInline[2]);
				if (child && parent) {
					if (!hierarchy[child]) hierarchy[child] = [];
					if (!hierarchy[child].includes(parent)) hierarchy[child].push(parent);
					console.log('OWL: найдено наследование (explicit inline):', child, '->', parent);
					return;
				}
			}

			// 1) Простая тройка: subj rdfs:subClassOf obj .
			const tripleMatch = block.match(/^(.+?)\s+rdfs:subClassOf\s+(.+?)\s*\.$/);
			if (tripleMatch) {
				const child = toLocalName(tripleMatch[1]);
				const parent = toLocalName(tripleMatch[2]);
				if (child && parent) {
					if (!hierarchy[child]) hierarchy[child] = [];
					if (!hierarchy[child].includes(parent)) hierarchy[child].push(parent);
					console.log('OWL: найдено наследование (простая тройка):', child, '->', parent);
				}
				return;
			}

			// 2) Блочная запись: subj a owl:Class ; ... rdfs:subClassOf obj ; ... .
			// Сначала извлекаем субъект
			const subjMatch = block.match(/^(.+?)\s+(a|rdf:type)\s+owl:Class\s*;/);
			if (subjMatch) {
				const child = toLocalName(subjMatch[1]);
				if (child) {
					// Ищем все вхождения rdfs:subClassOf внутри блока
					const subclassMatches = Array.from(block.matchAll(/rdfs:subClassOf\s+([^;\.]+)[;\.]/g));
					for (const m of subclassMatches) {
						const parent = toLocalName(m[1].trim());
						if (parent) {
							if (!hierarchy[child]) hierarchy[child] = [];
							if (!hierarchy[child].includes(parent)) hierarchy[child].push(parent);
							console.log('OWL: найдено наследование (блочно):', child, '->', parent);
						}
					}
				}
				return;
			}

			// 3) Иные варианты с QName в обеих частях: prefix:Child rdfs:subClassOf prefix:Parent .
			const qnameTriple = block.match(/^([A-Za-z_][\w-]*:[\w-]+|:[\w-]+)\s+rdfs:subClassOf\s+([A-Za-z_][\w-]*:[\w-]+|:[\w-]+)\s*\.$/);
			if (qnameTriple) {
				const child = toLocalName(qnameTriple[1]);
				const parent = toLocalName(qnameTriple[2]);
				if (child && parent) {
					if (!hierarchy[child]) hierarchy[child] = [];
					if (!hierarchy[child].includes(parent)) hierarchy[child].push(parent);
					console.log('OWL: найдено наследование (QName тройка):', child, '->', parent);
				}
			}
		});

		// 4) Дополнительный глобальный проход по всему тексту, чтобы поймать случаи внутри блоков с ;
		//    Примеры: ex:Reconstruction rdfs:subClassOf ex:Road ; ... .
		const globalSubclassRegex = /(^|\s)([A-Za-z_][\w-]*:[\w-]+|:[\w-]+)\s+rdfs:subClassOf\s+([A-Za-z_][\w-]*:[\w-]+|:[\w-]+)\s*[;\.]/g;
		for (const m of turtleCode.matchAll(globalSubclassRegex)) {
			const child = toLocalName(m[2]);
			const parent = toLocalName(m[3]);
			if (child && parent) {
				if (!hierarchy[child]) hierarchy[child] = [];
				if (!hierarchy[child].includes(parent)) hierarchy[child].push(parent);
				console.log('OWL: найдено наследование (глобальный проход):', child, '->', parent);
			}
		}

		// 5) Последняя страховка: максимально либеральный поиск, если все ещё пусто, но в тексте есть rdfs:subClassOf
		if (Object.keys(hierarchy).length === 0 && turtleCode.includes('rdfs:subClassOf')) {
			const looseRegex = /([^\s;]+)\s+rdfs:subClassOf\s+([^\s;]+)\s*[;\.]/g;
			let m;
			while ((m = looseRegex.exec(turtleCode)) !== null) {
				const child = toLocalName(m[1]);
				const parent = toLocalName(m[2]);
				if (child && parent) {
					if (!hierarchy[child]) hierarchy[child] = [];
					if (!hierarchy[child].includes(parent)) hierarchy[child].push(parent);
					console.log('OWL: найдено наследование (loose):', child, '->', parent);
				}
			}
		}

		// 6) Супер-простой проход без требования финального разделителя
		if (Object.keys(hierarchy).length === 0 && turtleCode.includes('rdfs:subClassOf')) {
			const bareRegex = /([A-Za-z_][\w-]*:[\w-]+|:[\w-]+)\s+rdfs:subClassOf\s+([A-Za-z_][\w-]*:[\w-]+|:[\w-]+)/g;
			let m;
			while ((m = bareRegex.exec(turtleCode)) !== null) {
				const child = toLocalName(m[1]);
				const parent = toLocalName(m[2]);
				if (child && parent) {
					if (!hierarchy[child]) hierarchy[child] = [];
					if (!hierarchy[child].includes(parent)) hierarchy[child].push(parent);
					console.log('OWL: найдено наследование (bare):', child, '->', parent);
				}
			}
		}

		// 7) Специальные предикаты для строго prefixed вида: ex:Child rdfs:subClassOf ex:Parent
		if (Object.keys(hierarchy).length === 0) {
			const strictPrefixed = /([A-Za-z_][\w-]*):([\w-]+)\s+rdfs:subClassOf\s+([A-Za-z_][\w-]*):([\w-]+)/g;
			let m;
			while ((m = strictPrefixed.exec(turtleCode)) !== null) {
				const child = m[2];
				const parent = m[4];
				if (!hierarchy[child]) hierarchy[child] = [];
				if (!hierarchy[child].includes(parent)) hierarchy[child].push(parent);
				console.log('OWL: найдено наследование (strict prefixed):', child, '->', parent);
			}
		}

		// Если все ещё пусто, выведем диагностический пример блока, содержащего rdfs:subClassOf
		if (Object.keys(hierarchy).length === 0) {
			const sample = blocks.find(b => b.includes('rdfs:subClassOf'));
			if (sample) {
				console.log('OWL: диагностический блок с subClassOf (как видит парсер):', sample);
			} else {
				console.log('OWL: ни один блок не содержит rdfs:subClassOf');
			}
		}

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
		
		// Группируем только два интересующих нас типа
		const errorTypes = {
			'обобщение дочернего класса': errors.filter(e => e.errorType === 'обобщение дочернего класса'),
			'обратная иерархия': errors.filter(e => e.errorType === 'обратная иерархия')
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
								${
									type === 'обобщение дочернего класса' ? '⛔ ОБРАТНЫЕ ИЕРАРХИИ' :
									type === 'обратная иерархия' ? '⛔ ОБРАТНЫЕ ИЕРАРХИИ' :
									type === 'несвязанная иерархия' ? '⚠️ НЕСВЯЗАННЫЕ ВЕТВИ IFC' :
									'⚠️ НАРУШЕНИЯ ИЕРАРХИЙ'
								}
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
										${type === 'обобщение дочернего класса' ? 
											'<div style="font-size: 12px; color: var(--warning-color); margin-top: 8px; padding: 8px; background: #fffbeb; border-radius: 4px;">' +
											'⚠️ <strong>Обнаружена обратная иерархия:</strong> Дочерний OWL отображён в более общий IFC-класс, чем родительский OWL' +
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
							<li style="margin-bottom: 8px;">Используйте классы из одной ветви IFC иерархии для связанных элементов</li>
							<li style="margin-bottom: 8px;">Если классы из разных ветвей IFC, рассмотрите возможность изменения маппинга</li>
						</ul>
					</div>
					
					<div style="margin-top: 15px; padding: 12px; background: #ecfdf5; border-radius: 6px; border-left: 4px solid var(--success-color);">
						<div style="font-size: 13px; color: var(--success-color); font-weight: 600;">
							💡 Система проверяет иерархию IFC из загруженной схемы
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
                            this.allIfcPropertiesCache = null;
                            this.invalidatePropertySetCache();
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
document.head.appendChild(style);
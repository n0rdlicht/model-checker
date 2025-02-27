import { PartialResult } from './interfaces.ts'

interface ProcessContentChunkProps {
  content: string
  regex: RegExp
  storeyData?: { [key: string]: string }
  typeRelations?: { [key: string]: string }
}

interface Rule {
  name: string
  regex: RegExp
  process: (props: ProcessContentChunkProps) => PartialResult[]
  check: (value: PartialResult[]) => { value: PartialResult[]; passed: boolean }
}

function extractAttributes({ content, regex }: ProcessContentChunkProps): PartialResult[] {
  const results: PartialResult[] = []
  let match

  while ((match = regex.exec(content)) !== null) {
    const globalId = match[1]
    const name = match[2]
    results.push({
      globalId,
      name,
      passed: !!name,
    })
  }

  return results
}

function extractBuildingStoreys({ content }: { content: string }): PartialResult[] {
  const storeyRegex = /IFCBUILDINGSTOREY\('([^']+)',#[^,]+,'([^']*)'/g
  const storeyDetails: PartialResult[] = []
  let match

  while ((match = storeyRegex.exec(content)) !== null) {
    storeyDetails.push({
      globalId: match[1],
      name: match[2],
      passed: true,
    })
  }

  return storeyDetails
}

function extractProxies({ content, regex }: ProcessContentChunkProps): PartialResult[] {
  const results: PartialResult[] = []
  let match

  while ((match = regex.exec(content)) !== null) {
    const type = match[1]
    const globalId = match[2]
    const name = match[3] || `Unnamed ${type}`

    results.push({
      globalId,
      name: `${name} (${type})`, // Append type to name
      passed: type !== 'BUILDINGELEMENTPROXY', // Proxies fail, others pass
    })
  }

  for (const match of content.matchAll(regex)) {
    const globalId = match[2]
    const name = match[3] || `Unnamed ${match[1]}`
    if (!results.some((result) => result.globalId === globalId)) {
      results.push({
        globalId,
        name: `${name} (${match[1]})`, // Append type to name
        passed: match[1] !== 'BUILDINGELEMENTPROXY', // Proxies fail, others pass
      })
    }
  }

  return results
}

function extractSpaceNames({ content }: { content: string }): PartialResult[] {
  const spaceRegex = /IFCSPACE\('([^']+)',#[^,]+,'([^']*)'/g
  const spaces: PartialResult[] = []
  let match

  while ((match = spaceRegex.exec(content)) !== null) {
    const globalId = match[1]
    const name = match[2]
    const passed = !!name && name.trim() !== '' // Ensure name exists and is not empty
    spaces.push({
      globalId,
      name,
      passed,
    })
  }
  return spaces
}

function checkStoreyRelation({ content, regex }: ProcessContentChunkProps): PartialResult[] {
  const results: PartialResult[] = []
  const relContainedRegex = /#(\d+)=IFCRELCONTAINEDINSPATIALSTRUCTURE\([^,]*,[^,]*,.*?,(\(#[^)]*\)),#(\d+)\);/gi
  const relatedEntities: { [key: string]: string } = {}

  let match: RegExpExecArray | null

  while ((match = relContainedRegex.exec(content)) !== null) {
    const entityList = match[2]
    const storeyId = match[3]
    const entities = entityList.match(/#(\d+)/g)
    if (entities) {
      entities.forEach((entity) => {
        relatedEntities[entity.replace('#', '')] = storeyId
      })
    }
  }

  while ((match = regex.exec(content)) !== null) {
    const { entityId, globalId, name } = match.groups!
    const passed = Object.hasOwn(relatedEntities, entityId)
    results.push({
      globalId,
      name,
      passed,
    })
  }

  return results
}

function checkDescriptions({
  content,
  regex,
  allElements,
}: {
  content: string
  regex: RegExp
  allElements: PartialResult[]
}): PartialResult[] {
  const results: PartialResult[] = []
  let match: RegExpExecArray | null

  const descriptionMap: { [key: string]: PartialResult } = {}

  while ((match = regex.exec(content)) !== null) {
    const { globalId, name, description } = match.groups!
    const passed = description !== '$' && description.trim() !== '' // Ensure description is valid
    descriptionMap[globalId] = {
      globalId,
      name: `${name} (${description})`, // Append description to name
      passed,
    }
  }

  for (const element of allElements) {
    if (element.globalId && descriptionMap[element.globalId]) {
      results.push(descriptionMap[element.globalId])
    } else {
      results.push({
        globalId: element.globalId || '', // Fallback to empty string if globalId is not found
        name: element.name,
        passed: false,
      })
    }
  }

  return results
}

function checkTypeNames({ content, regex }: ProcessContentChunkProps): PartialResult[] {
  const results: PartialResult[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const { globalId, name, type } = match.groups!
    const validType = type.trim() !== '' && type !== '-'
    const passed = validType && type !== '$' // Ensure type name is valid
    results.push({
      globalId,
      name: `${name} (${type})`, // Append type to name
      passed,
    })
  }

  // Ensure all elements are checked even if no type name is found
  for (const match of content.matchAll(regex)) {
    const { globalId, name, type } = match.groups!
    const validType = type.trim() !== '' && type !== '-'
    if (!results.some((result) => result.globalId === globalId)) {
      results.push({
        globalId,
        name: `${name} (${type})`, // Append type to name
        passed: validType && type !== '$' && type.trim() !== '', // Ensure type name is valid
      })
    }
  }

  return results
}

function getElementsWithMaterialAssociations(content: string): { [key: string]: string } {
  const relAssociatesMaterialRegex = /#(\d+)=IFCRELASSOCIATESMATERIAL\([^,]*,[^,]*,.*?,\(([^)]*)\),#(\d+)\);/g
  const elementRegex = /#(\d+)/g
  const elementToMaterial: { [key: string]: string } = {}

  let match: RegExpExecArray | null

  while ((match = relAssociatesMaterialRegex.exec(content)) !== null) {
    const materialId = match[3]
    const elements = match[2].match(elementRegex) || []

    for (const element of elements) {
      const elementId = element.replace('#', '')
      elementToMaterial[elementId] = materialId
    }
  }

  return elementToMaterial
}

function getAllRelevantElements(content: string): { [key: string]: PartialResult } {
  const elementRegex =
    /#(\d+)=IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)'/g
  const results: { [key: string]: PartialResult } = {}
  let match: RegExpExecArray | null

  while ((match = elementRegex.exec(content)) !== null) {
    const elementId = match[1]
    const globalId = match.groups!.globalId
    const name = match.groups!.name
    results[elementId] = {
      globalId: globalId,
      name: `${name}`,
      passed: false, // Initialize as false, will be updated later
    }
  }

  return results
}

function checkMaterialAssignments(content: string): PartialResult[] {
  const elementToMaterial = getElementsWithMaterialAssociations(content)
  const allElements = getAllRelevantElements(content)

  for (const elementId in allElements) {
    if (Object.hasOwn(elementToMaterial, elementId)) {
      allElements[elementId].passed = true
    }
  }

  return Object.values(allElements)
}

function checkPredefinedTypes({ content, regex }: ProcessContentChunkProps): PartialResult[] {
  const results: PartialResult[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(content)) !== null) {
    const { globalId, name, predefinedType } = match.groups!
    const passed = predefinedType !== 'NOTDEFINED' // Only fail if predefined type is NOTDEFINED
    results.push({
      globalId,
      name: `${name} (${predefinedType})`, // Append predefinedType to name
      passed,
    })
  }

  // Ensure all elements with predefined types are checked even if no predefined type is found initially
  for (const match of content.matchAll(regex)) {
    const { globalId, name, predefinedType } = match.groups!
    if (!results.some((result) => result.globalId === globalId)) {
      results.push({
        globalId,
        name: `${name} (${predefinedType})`, // Append predefinedType to name
        passed: predefinedType !== 'NOTDEFINED', // Only fail if predefined type is NOTDEFINED
      })
    }
  }

  return results
}

function checkElementNames({ content, regex }: ProcessContentChunkProps): PartialResult[] {
  const elementRegex =
    /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)'/g
  const results: PartialResult[] = []
  let match: RegExpExecArray | null

  while ((match = elementRegex.exec(content)) !== null) {
    const { globalId, name } = match.groups!
    const validName = name.trim() !== ''
    const passed = validName && name !== '$' // Ensure name is valid
    results.push({
      globalId,
      name: validName ? name : `Unnamed`,
      passed,
    })
  }

  // Ensure all elements are checked even if no name is found
  for (const match of content.matchAll(regex)) {
    const { globalId, name } = match.groups!
    const validName = name.trim() !== ''
    if (!results.some((result) => result.globalId === globalId)) {
      results.push({
        globalId,
        name: validName ? name : `Unnamed`,
        passed: validName && name !== '$' && name.trim() !== '', // Ensure name is valid
      })
    }
  }

  return results
}

function getIfcRelationships(content: string): { [key: string]: string[] } {
  const relAggregatesRegex = /#(\d+)=IFCRELAGGREGATES\([^,]*,[^,]*,.*?,#(\d+),\(([^)]*)\)\);/g
  const relationships: { [key: string]: string[] } = {}
  let match: RegExpExecArray | null

  while ((match = relAggregatesRegex.exec(content)) !== null) {
    const parentId = match[2]
    const childrenIds = match[3].match(/#(\d+)/g)?.map((id) => id.replace('#', '')) || []
    if (!relationships[parentId]) {
      relationships[parentId] = []
    }
    relationships[parentId].push(...childrenIds)
  }

  return relationships
}

function getBuildingStoreys(content: string): string[] {
  const buildingStoreysRegex = /#(\d+)=IFCBUILDINGSTOREY\(/g
  const storeyIds: string[] = []
  let match: RegExpExecArray | null

  while ((match = buildingStoreysRegex.exec(content)) !== null) {
    storeyIds.push(match[1])
  }

  return storeyIds
}

function getElementsInStoreys(content: string): { [key: string]: string } {
  const storeyElementsRegex = /#(\d+)=IFCRELCONTAINEDINSPATIALSTRUCTURE\([^,]*,[^,]*,.*?,\(([^)]*)\),#(\d+)\);/g
  const elementsInStoreys: { [key: string]: string } = {}
  let match: RegExpExecArray | null

  while ((match = storeyElementsRegex.exec(content)) !== null) {
    const storeyId = match[3]
    const elements = match[2].match(/#(\d+)/g)?.map((id) => id.replace('#', '')) || []
    elements.forEach((element) => {
      elementsInStoreys[element] = storeyId
    })
  }

  return elementsInStoreys
}

function checkBuildingRelation({ content }: ProcessContentChunkProps): PartialResult[] {
  const storeyIds = getBuildingStoreys(content)
  const storeyElements = getElementsInStoreys(content)
  const relAggregates = getIfcRelationships(content)

  const allStoreyIds = new Set<string>(storeyIds)
  storeyIds.forEach((storeyId) => {
    if (relAggregates[storeyId]) {
      relAggregates[storeyId].forEach((id) => allStoreyIds.add(id))
    }
  })

  const results: PartialResult[] = []
  const entityPattern = new RegExp(
    /#(?<entityId>\d+)=IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)'/g,
  )

  let match: RegExpExecArray | null
  while ((match = entityPattern.exec(content)) !== null) {
    const { entityId, globalId, name } = match.groups!
    const storeyId = storeyElements[entityId]
    const passed = Boolean(storeyId && allStoreyIds.has(storeyId))
    results.push({
      globalId,
      name,
      passed,
    })
  }

  return results
}

// Rule definitions
// Rules are intended to work only on valid IFC, non valid file structure and non-adherence to schema will cause certain rules to not function as intended
export const rules: Rule[] = [
  {
    name: 'project-name',
    regex: /IFCPROJECT\('([^']+)',#[^,]+,'([^']+)'/gi,
    process: extractAttributes,
    check: (value) => ({ value, passed: value.length > 0 }),
  },
  {
    name: 'project-relation',
    regex:
      /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('([^']+)',#[^,]+,'([^']+)'/gi,
    process: checkBuildingRelation,
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if all objects pass
  },
  {
    name: 'site-name',
    regex: /IFCSITE\('([^']+)',#[^,]+,'([^']+)'/gi,
    process: extractAttributes,
    check: (value) => ({ value, passed: value.length > 0 }),
  },
  {
    name: 'site-relation',
    regex:
      /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('([^']+)',#[^,]+,'([^']+)'/gi,
    process: checkBuildingRelation,
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if all objects pass
  },
  {
    name: 'building-name',
    regex: /IFCBUILDING\('([^']+)',#[^,]+,'([^']+)'/gi,
    process: extractAttributes,
    check: (value) => ({ value, passed: value.length > 0 }),
  },
  {
    name: 'building-relation',
    regex:
      /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('([^']+)',#[^,]+,'([^']+)'/gi,
    process: checkBuildingRelation,
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if all objects pass
  },
  {
    name: 'story-name',
    regex: /IFCBUILDINGSTOREY\('([^']+)',#[^,]+,'([^']*)'/gi,
    process: ({ content }) => extractBuildingStoreys({ content }),
    check: (value) => ({ value, passed: value.length > 0 }),
  },
  {
    name: 'story-relation',
    regex:
      /#(?<entityId>\d+)=IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)'/gi,
    process: ({ content, regex }) => checkStoreyRelation({ content, regex }),
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if all objects pass
  },
  {
    name: 'space-name',
    regex: /IFCSPACE\('([^']+)',#[^,]+,'([^']*)'/gi,
    process: ({ content }) => extractSpaceNames({ content }),
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if all spaces have names
  },
  {
    name: 'object-name',
    regex:
      /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)'/gi,
    process: ({ content, regex }) => checkElementNames({ content, regex }),
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if all elements have valid names
  },
  {
    name: 'object-description',
    regex:
      /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)','(?<description>[^']*)'/gi,
    process: ({ content, regex }) => {
      const allElements = checkElementNames({
        content,
        regex:
          /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)'/gi,
      })
      return checkDescriptions({ content, regex, allElements })
    },
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if all objects have valid descriptions
  },
  {
    name: 'type-name',
    regex:
      /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)',[^,]*,'(?<type>[^']*)'/gi,
    process: ({ content, regex }) => checkTypeNames({ content, regex }),
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if all objects have valid type names
  },
  {
    name: 'material-name',
    regex:
      /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)'/gi,
    process: ({ content }) => checkMaterialAssignments(content),
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if all objects have material names
  },
  {
    name: 'predefined-type',
    regex:
      /#(?<entityId>\d+)=IFC(WALLSTANDARDCASE|DOOR|WINDOW|SLAB|COLUMN|BEAM|BUILDINGELEMENTPROXY|JUNCTIONBOX|DUCTSEGMENT)\('(?<globalId>[^']+)',#[^,]+,'(?<name>[^']*)',[^)]*?\.(?<predefinedType>[A-Z_]+)\.\);/gi,
    process: ({ content, regex }) => checkPredefinedTypes({ content, regex }),
    check: (value) => ({ value, passed: value.every((result) => result.passed) }), // Pass if predefined types are not UNDEFINED
  },
  {
    name: 'object-count',
    regex:
      /IFC(AIRTERMINAL|ALARM|BEAM|CABLECARRIERFITTING|CABLECARRIERSEGMENT|COLUMN|COVERING|CURTAINWALL|DAMPER|DOOR|DUCTFITTING|DUCTSEGMENT|DUCTSILENCER|ELECTRICAPPLIANCE|ELECTRICDISTRIBUTIONBOARD|FAN|FIRESUPPRESSIONTERMINAL|FLOWMETER|FLOWSEGMENT|FOOTING|JUNCTIONBOX|LIGHTFIXTURE|MEMBER|OUTLET|PILE|PIPEFITTING|PIPESEGMENT|PUMP|RAILING|RAMPFLIGHT|SLAB|STAIRFLIGHT|SWITCHINGDEVICE|SYSTEMFURNITUREELEMENT|TANK|VALVE|WALL|WASTETERMINAL|WINDOW|WALLSTANDARDCASE)\('([^']+)',#[^,]+,'([^']*)'/gi,
    process: ({ content, regex }) => extractProxies({ content, regex }),
    check: (value) => ({ value, passed: value.every((element) => element.passed) }), // Pass if all objects pass (no proxies found)
  },
]

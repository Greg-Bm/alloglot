import { readFileSync } from 'fs'
import * as vscode from 'vscode'

/**
 * Extension configuration.
 */
export type TConfig = {
  /**
   * A shell command to run on activation.
   * The command will run asynchronously.
   * It will be killed (if it's still running) on deactivation.
   */
  activateCommand?: string

  /**
   * If `true`, Alloglot will automatically reveal the activation command's output channel.
   */
  revealActivateCommandOutput?: boolean

  /**
   * An array of per-language configurations.
   */
  languages?: Array<LanguageConfig>

  /**
   * If `true`, Alloglot will log more output.
   */
  verboseOutput?: boolean

  /**
   * If `true`, Alloglot will merge `.vscode/alloglot.json` into its config.
   */
  mergeConfigs?: boolean

  /**
   * Path to GNU Grep. Parsing tags files depends on GNU Grep. (BSD Grep is not supported.)
   */
  grepPath?: string
}

/**
 * Configuration for an arbitrary language.
 */
export type LanguageConfig = {
  /**
   * The unique language ID.
   * You can usually find this in a language's syntax-highlighting extension.
   */
  languageId: string

  /**
   * A shell command to start the language server.
   */
  serverCommand?: string

  inlayHints?: Boolean

  /**
   * A formatter shell command.
   * STDIN will be equal to the contents of the current text document,
   * not the file contents as it exists on disk.
   * STDOUT will replace the entire contents of the current text document.
   * Alloglot will not modify the file on disk (though your command might!).
   * `${file}` will be replaced with the full path to the file.
   */
  formatCommand?: string

  /**
   * A shell command to run after a file is saved.
   * `${file}` will be replaced with the full path to the file.
   */
  onSaveCommand?: string

  /**
   * URL to documentation/API search.
   * `${query}` will be replaced with the symbol under cursor.
   */
  apiSearchUrl?: string

  /**
   * A list of tags files to use to find definitions, suggest completions, or suggest imports.
   */
  tags?: Array<TagsConfig>

  /**
   * A list of files to watch for compiler-generated JSON output.
   */
  annotations?: Array<AnnotationsConfig>
}

export type TagsConfig = {
  /**
   * The relative path to the tags file.
   */
  file: string

  /**
   * A command to generate the tags file.
   */
  initTagsCommand?: string

  /**
   * A command to refresh the tags file when a file is saved.
   * `${file}` will be replaced with the full path to the file.
   */
  refreshTagsCommand?: string

  /**
   * Indicates that this tags file should be used to suggest completions.
   */
  completionsProvider?: boolean

  /**
   * Indicates that this tags file should be used to go to definitions.
   */
  definitionsProvider?: boolean

  /**
   * Indicates that this tags file should be used to suggest imports for symbols.
   */
  importsProvider?: ImportsProviderConfig
}

/**
 * Configuration to use a tags file to suggests imports.
 */
export type ImportsProviderConfig = {
  /**
   * Pattern to create an import line.
   * `${module}` will be replaced with the module to import.
   * `${symbol}` will be replaced with the symbol to expose.
   */
  importLinePattern: string,

  /**
   * Regex pattern matching the part of a file path needed to construct a module name.
   * (We will use the entire _match,_ not the captures.)
   * (Remember to double-escape backslashes in JSON strings.)
   */
  matchFromFilepath: string

  /**
   * A list of transformations to apply to the string matched by `matchFromFilepath`.
   */
  renderModuleName: Array<StringTransformation>
}

export type StringTransformation
  = { tag: "replace", from: string, to: string }
  | { tag: "split", on: string }
  | { tag: "join", with: string }
  | { tag: "toUpper" }
  | { tag: "toLower" }
  | { tag: "capitalize" }

/**
 * A file to watch for compiler-generated JSON output, and instructions on how to marshal the JSON objects.
 */
export type AnnotationsConfig = {
  /**
   * The relative path to the file to watch.
   */
  file: string

  /**
   * `json` for a top-level array of objects.
   * `jsonl` for a newline-separated stream of objects.
   */
  format: 'json' | 'jsonl'

  /**
   * Mapping between properties of the JSON objects and properties of `Annotation`.
   */
  mapping: AnnotationsMapping
}

/**
 * Intermediate representation of compiler-generated JSON output and VS Code diagnostics.
 */
export type Annotation = {
  source: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  file: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  message: string
  replacements: Array<string>
  referenceCode?: string
}

/**
 * Mapping between arbitrary JSON object and properties of `Annotation`.
 * Each property is an array of strings that will be used as a path into the JSON object.
 */
export type AnnotationsMapping = {
  message: Array<string>
  file?: Array<string>
  startLine?: Array<string>
  startColumn?: Array<string>
  endLine?: Array<string>
  endColumn?: Array<string>
  source?: Array<string>
  severity?: Array<string>
  replacements?: Array<string>
  referenceCode?: Array<string>
}

export namespace Config {
  export function make(output: vscode.OutputChannel): TConfig {
    const workspace = readWorkspace(output)
    const fallback = readFallback(output)

    if (workspace?.mergeConfigs && fallback) {
      output.appendLine(alloglot.ui.mergingConfigs)
      return merge(sanitize(output, workspace), sanitize(output, fallback))
    } else {
      return sanitize(output, workspace || fallback || empty)
    }
  }

  function readFallback(output: vscode.OutputChannel): TConfig | undefined {
    try {
      const workspaceFolders = vscode.workspace.workspaceFolders?.map(folder => folder.uri)
      if (workspaceFolders && workspaceFolders.length > 0) {
        const fullPath = vscode.Uri.joinPath(workspaceFolders[0], alloglot.config.fallbackPath)
        output.appendLine(alloglot.ui.readingFallbackConfig(fullPath.path))
        return JSON.parse(readFileSync(fullPath.path, 'utf-8'))
      } else {
        output.appendLine(alloglot.ui.noWorkspaceFolders)
        return undefined
      }
    } catch (err) {
      output.appendLine(alloglot.ui.couldNotReadFallback(err))
      return undefined
    }
  }

  function readWorkspace(output: vscode.OutputChannel): TConfig | undefined {
    try {
      output.appendLine(alloglot.ui.readingWorkspaceSettings)
      const workspaceSettings = vscode.workspace.getConfiguration(alloglot.config.root)
      const activateCommand = workspaceSettings.get<string>(alloglot.config.activateCommand)
      const revealActivateCommandOutput = workspaceSettings.get<boolean>(alloglot.config.revealActivateCommandOutput)
      const languages = workspaceSettings.get<Array<LanguageConfig>>(alloglot.config.languages)
      const verboseOutput = workspaceSettings.get<boolean>(alloglot.config.verboseOutput)
      const mergeConfigs = workspaceSettings.get<boolean>(alloglot.config.mergeConfigs)
      const grepPath = workspaceSettings.get<string>(alloglot.config.grepPath)
      const settingsExist = !!activateCommand || !!revealActivateCommandOutput || !!languages || !!verboseOutput || !!mergeConfigs || !!grepPath
      output.appendLine(alloglot.ui.workspaceConfigExists(settingsExist))
      if (settingsExist) return { activateCommand, revealActivateCommandOutput, languages, verboseOutput, mergeConfigs, grepPath }
      return undefined
    } catch (err) {
      output.appendLine(alloglot.ui.couldNotReadWorkspace(err))
      return undefined
    }
  }

  const empty: TConfig = {}

  function sanitize(output: vscode.OutputChannel, config: TConfig): TConfig {
    try {
      config.activateCommand = config.activateCommand?.trim()
      config.grepPath = config.grepPath?.trim()
      config.languages = config.languages?.filter(lang => {

        lang.languageId = lang.languageId.trim()
        lang.serverCommand = lang.serverCommand?.trim()
        lang.formatCommand = lang.formatCommand?.trim()
        lang.onSaveCommand = lang.onSaveCommand?.trim()
        lang.apiSearchUrl = lang.apiSearchUrl?.trim()

        lang.annotations = lang.annotations?.filter(ann => {
          ann.file = ann.file.trim()
          return ann.file
        })
        if (lang.annotations) lang.annotations = arrayUniqueBy(ann => ann.file, lang.annotations)

        lang.tags = lang.tags?.filter(tag => {
          tag.file = tag.file.trim()
          tag.initTagsCommand = tag.initTagsCommand?.trim()
          tag.refreshTagsCommand = tag.refreshTagsCommand?.trim()
          if (!tag?.importsProvider?.importLinePattern.trim()) tag.importsProvider = undefined
          if (!tag?.importsProvider?.matchFromFilepath.trim()) tag.importsProvider = undefined
          return tag.file
        })
        if (lang.tags) lang.tags = arrayUniqueBy(tag => tag.file, lang.tags)

        return lang.languageId
      })
      if (config.languages) config.languages = arrayUniqueBy(lang => lang.languageId, config.languages)

      return config
    } catch (err) {
      output.appendLine(alloglot.ui.couldNotSanitizeConfig(err))
      return empty
    }
  }

  function merge(mask: TConfig, base: TConfig): TConfig {
    return {
      activateCommand: mask.activateCommand || base.activateCommand,
      languages: arrayMerge(mask.languages || [], base.languages || [], lang => lang.languageId, languageMerge),
      revealActivateCommandOutput: typeof mask.revealActivateCommandOutput === 'boolean' ? mask.revealActivateCommandOutput : base.revealActivateCommandOutput,
      verboseOutput: typeof mask.verboseOutput === 'boolean' ? mask.verboseOutput : base.verboseOutput,
      mergeConfigs: typeof mask.mergeConfigs === 'boolean' ? mask.mergeConfigs : base.mergeConfigs
    }
  }

  function languageMerge(mask: LanguageConfig, base: LanguageConfig): LanguageConfig {
    return {
      languageId: mask.languageId,
      serverCommand: mask.serverCommand || base.serverCommand,
      formatCommand: mask.formatCommand || base.formatCommand,
      apiSearchUrl: mask.apiSearchUrl || base.apiSearchUrl,
      tags: arrayMerge(mask.tags || [], base.tags || [], tag => tag.file, tagMerge),
      annotations: arrayMerge(mask.annotations || [], base.annotations || [], ann => ann.file, (mask, base) => mask)
    }
  }

  function tagMerge(mask: TagsConfig, base: TagsConfig): TagsConfig {
    return {
      file: mask.file,
      completionsProvider: typeof mask.completionsProvider === 'boolean' ? mask.completionsProvider : base.completionsProvider,
      definitionsProvider: typeof mask.definitionsProvider === 'boolean' ? mask.definitionsProvider : base.definitionsProvider,
      importsProvider: mask.importsProvider || base.importsProvider,
      initTagsCommand: mask.initTagsCommand || base.initTagsCommand,
      refreshTagsCommand: mask.refreshTagsCommand || base.refreshTagsCommand
    }
  }

  function arrayUniqueBy<K, V>(key: (val: V) => K, xs: Array<V>): Array<V> {
    return arrayMerge<K, V>(xs, [], key, (l, r) => l)
  }

  function arrayMerge<K, V>(left: Array<V>, right: Array<V>, key: (val: V) => K, merge: (l: V, r: V) => V): Array<V> {
    const leftMap = new Map(left.map(x => [key(x), x]))
    const rightMap = new Map(right.map(x => [key(x), x]))
    return Array.from(mapMerge(leftMap, rightMap, merge).values())
  }

  function mapMerge<K, V>(left: Map<K, V>, right: Map<K, V>, merge: (l: V, r: V) => V): Map<K, V> {
    const result = new Map<K, V>()
    for (const [k, v] of left) result.set(k, v)
    for (const [k, v] of right) result.set(k, result.has(k) ? merge(result.get(k)!, v) : v)
    return result
  }
}

export namespace alloglot {
  export const root = 'alloglot' as const

  export namespace ui {
    export const activateCommandDone = (cmd: string) => `Activation command “${cmd}” has completed.`
    export const addImport = (moduleName: string) => `Add import: ${moduleName}`
    export const annotationsStarted = 'Annotations started.'
    export const appliedEdit = (success: boolean) => `Applied edit: ${success}`
    export const applyingTransformation = (t: any, xs: Array<string>) => `Applying single transformation ${JSON.stringify(t)} to split string array ${xs}`
    export const applyingTransformations = (t: any, x: string) => `Applying transformations ${JSON.stringify(t)} to string ${x}`
    export const commandKilled = (cmd: string) => `Killed “${cmd}”.`
    export const commandNoOutput = (cmd: string) => `Received no output from “${cmd}”.`
    export const couldNotReadFallback = (err: any) => `Could not read fallback configuration: ${err}`
    export const couldNotReadWorkspace = (err: any) => `Could not read workspace configuration: ${err}`
    export const couldNotSanitizeConfig = (err: any) => `Configuration is malformed: ${err}`
    export const creatingApiSearch = (langIds: Array<string>) => `Creating API search command for languages: ${langIds}`
    export const creatingTagsSource = (path: string) => `Creating tags source for path: ${path}`
    export const errorKillingCommand = (cmd: string, err: any) => `Error killing “${cmd}”:\n\t${err}`
    export const errorRunningCommand = (cmd: string, err: any) => `Error running “${cmd}”:\n\t${err}`
    export const fileMatcherResult = (result: any) => `Match: ${result}`
    export const findingImportPosition = 'Finding import position...'
    export const formatterStarted = 'Formatter started.'
    export const foundBlankLine = (line: number) => `Found blank line at line ${line}`
    export const foundImportPosition = (line: number) => `Found import at line ${line}`
    export const killingCommand = (cmd: string) => `Killing “${cmd}”...`
    export const languageClientStarted = 'Language client started.'
    export const languageClientStopped = 'Language client stopped.'
    export const makingImportSuggestion = (tag: any) => `Making import suggestion for tag: ${JSON.stringify(tag)}`
    export const mergingConfigs = 'Merging workspace configuration with “.vscode/alloglot.json”...'
    export const noBlankLineFound = 'No blank line found. Inserting import at start of file.'
    export const noWorkspaceFolders = 'No workspace folders found. Cannot read fallback configuration.'
    export const parsedTagLine = (tag: any) => `Parsed tag: ${JSON.stringify(tag)}`
    export const parsingTagLine = (line: string) => `Parsing tag line: ${line}`
    export const pickedSuggestion = (suggestion: any) => `Picked: ${JSON.stringify(suggestion)}`
    export const providingCodeActions = 'Providing code actions...'
    export const ranCommand = (cmd: string) => `Ran “${cmd}”.`
    export const readingFallbackConfig = (path: string) => `Reading fallback configuration from path: ${path}`
    export const readingWorkspaceSettings = 'Reading configuration from workspace settings'
    export const registeredCompletionsProvider = 'Registered completions provider.'
    export const registeredDefinitionsProvider = 'Registered definitions provider.'
    export const registeredImportsProvider = 'Registered imports provider.'
    export const registeredOnSaveCommand = 'Registered on-save command.'
    export const registeringCompletionsProvider = 'Registering completions provider...'
    export const registeringDefinitionsProvider = 'Registering definitions provider...'
    export const registeringImportsProvider = 'Registering imports provider...'
    export const registeringOnSaveCommand = 'Registering on-save command...'
    export const renderedImportLine = (line?: string) => `Rendered import line: ${line}`
    export const renderedModuleName = (name?: string) => `Rendered module name: ${name}`
    export const renderingImportLine = (tag: any) => `Rendering import line for tag: ${JSON.stringify(tag)}`
    export const runningCommand = (cmd: string, cwd?: string) => `Running “${cmd}” in “${cwd}”...`
    export const runningSuggestImports = 'Running suggest imports...'
    export const splittingOutputChannel = (name: string) => `Creating new output channel: ${name}`
    export const startingAlloglot = 'Starting Alloglot...'
    export const startingAnnotations = 'Starting annotations...'
    export const startingFormatter = 'Starting formatter...'
    export const startingLanguageClient = 'Starting language client...'
    export const startingTags = 'Starting tags...'
    export const stoppingLanguageClient = 'Stopping language client...'
    export const tagsStarted = 'Tags started.'
    export const transformationResult = (x: string) => `Result: ${x}`
    export const usingConfig = (config: any) => `Using configuration:\n${JSON.stringify(config, null, 2)}`
    export const usingFileMatcher = (matcher: any) => `File matcher: ${matcher}`
    export const workspaceConfigExists = (exists: boolean) => `Configuration exists in settings: ${exists}`
  }

  export namespace collections {
    const root = `${alloglot.root}.collections` as const
    export const annotations = `${root}.annotations` as const
  }

  export namespace components {
    export const activateCommand = 'activatecommand' as const
    export const apiSearch = 'apisearch' as const
    export const annotations = 'annotations' as const
    export const formatter = 'formatter' as const
    export const client = 'client' as const
    export const onSaveRunner = 'onsaverunner' as const
    export const tags = 'tags' as const
    export const tagsSource = 'tagssource' as const
    export const importsProvider = 'importsprovider' as const
  }

  export namespace commands {
    const root = `${alloglot.root}.command` as const
    export const apiSearch = `${root}.apisearch` as const
    export const suggestImports = `${root}.suggestimports` as const
  }

  export namespace config {
    export const root = alloglot.root
    export const fallbackPath = `.vscode/${root}.json` as const
    export const grepPath = 'grepPath' as const
    export const languages = 'languages' as const
    export const activateCommand = 'activateCommand' as const
    export const revealActivateCommandOutput = 'revealActivateCommandOutput' as const
    export const onSaveCommand = 'onSaveCommand' as const
    export const verboseOutput = 'verboseOutput' as const
    export const mergeConfigs = 'mergeConfigs' as const
  }
}

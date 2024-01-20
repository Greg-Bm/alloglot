import * as vscode from 'vscode'

import { Config, Elem, alloglot } from "./config";

export function makeAnnotations(lang: Elem<Config['languages']>): vscode.Disposable {
  const files = lang.annotationsFiles.map(x => x.trim()).filter(x => x.length !== 0)
  if (files.length === 0) return { dispose: () => { } }

  const diagnostics = vscode.languages.createDiagnosticCollection(alloglot.collections.annotations)
  const watchers = files.map(watchAnnotationsFile(diagnostics)).flat()

  const actions = vscode.languages.registerCodeActionsProvider(
    lang.languageId,
    { provideCodeActions: (document, range, context) => context.diagnostics.map(asQuickFixes).flat() },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  )

  return vscode.Disposable.from(
    actions,
    ...watchers,
    diagnostics
  )
}

function watchAnnotationsFile(diagnostics: vscode.DiagnosticCollection): (file: string) => vscode.Disposable {
  return file => {
    const watchers = vscode.workspace.workspaceFolders?.map(ws => {
      const pattern = new vscode.RelativePattern(ws, file)
      const watcher = vscode.workspace.createFileSystemWatcher(pattern, false, false, false)

      watcher.onDidChange(addAnnotations(diagnostics))
      watcher.onDidCreate(addAnnotations(diagnostics))
      watcher.onDidDelete(uri => diagnostics.delete(uri))

      return watcher
    }) || []

    return vscode.Disposable.from(...watchers)
  }
}

type Annotation = {
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

function addAnnotations(diagnostics: vscode.DiagnosticCollection): (uri: vscode.Uri) => void {
  return uri => {
    vscode.workspace.fs.readFile(uri).then(bytes => {
      const annotations: Array<Annotation> = JSON.parse(Buffer.from(bytes).toString('utf8')) || []
      const sorted: Map<string, Array<Annotation>> = new Map()
      annotations.forEach(ann => {
        const current = sorted.get(ann.file)
        current
          ? current.push(ann)
          : sorted.set(ann.file, [ann])
      })
      sorted.forEach((anns, path) => {
        diagnostics.set(vscode.Uri.file(path), anns.map(asDiagnostic))
      })
    })
  }
}

function asDiagnostic(ann: Annotation): vscode.Diagnostic {
  const range = annotationRange(ann)
  const message = ann.message
  const severity = asDiagnosticSeverity(ann.severity)
  const diag = new vscode.Diagnostic(range, message, severity)
  diag.source = ann.source
  diag.relatedInformation = annotationRelatedInformation(ann)
  diag.code = diag.code
  return diag
}

function annotationRelatedInformation(ann: Annotation): Array<vscode.DiagnosticRelatedInformation> {
  const uri = vscode.Uri.file(ann.file)
  const range = annotationRange(ann)
  const location = new vscode.Location(uri, range)
  return ann.replacements.map(message => new vscode.DiagnosticRelatedInformation(location, message))
}

function annotationRange(ann: Annotation): vscode.Range {
  const start = new vscode.Position(ann.startLine - 1, ann.startColumn - 1)
  const end = new vscode.Position(ann.endLine - 1, ann.endColumn - 1)
  return new vscode.Range(start, end)
}

function asDiagnosticSeverity(sev: Annotation['severity']): vscode.DiagnosticSeverity {
  switch (sev) {
    case 'error': return vscode.DiagnosticSeverity.Error
    case 'warning': return vscode.DiagnosticSeverity.Warning
    case 'info': return vscode.DiagnosticSeverity.Information
    case 'hint': return vscode.DiagnosticSeverity.Hint
  }
}

function asQuickFixes(diag: vscode.Diagnostic): Array<vscode.CodeAction> {
  const actions = diag.relatedInformation?.map(info => {
    const action = new vscode.CodeAction(diag.message, vscode.CodeActionKind.QuickFix)
    action.diagnostics = [diag]
    action.edit = new vscode.WorkspaceEdit
    action.edit.replace(info.location.uri, info.location.range, info.message)
    return action
  })
  return actions || []
}
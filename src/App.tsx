import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Excalidraw, serializeAsJSON } from '@excalidraw/excalidraw'
import '@excalidraw/excalidraw/index.css'
import type { ImportedDataState } from '@excalidraw/excalidraw/data/types'
import {
  ArrowLeft,
  Cloud,
  FilePlus2,
  Loader2,
  LogOut,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from 'lucide-react'
import './App.css'

type DrawingSummary = {
  bytes: number
  createdAt: string
  elementCount: number
  id: string
  objectKey: string
  title: string
  updatedAt: string
}

type ExcalidrawScene = {
  appState: Record<string, unknown>
  elements: readonly unknown[]
  files: Record<string, unknown>
  source: string
  type: 'excalidraw'
  version: number
}

type LibraryItems = NonNullable<ImportedDataState['libraryItems']>

type Route =
  | { name: 'list' }
  | { name: 'login' }
  | { id: string; name: 'editor' }

type SaveState = 'idle' | 'saving' | 'saved' | 'unchanged' | 'waiting-files' | 'error'

const EXCALIDRAW_LANG_CODE = 'zh-CN'
const AUTOSAVE_STORAGE_KEY = 'excalidraw-minio-autosave'

const emptyScene: ExcalidrawScene = {
  appState: { viewBackgroundColor: '#ffffff' },
  elements: [],
  files: {},
  source: 'excalidraw-minio',
  type: 'excalidraw',
  version: 2,
}

function toInitialData(scene: ExcalidrawScene, libraryItems: LibraryItems | undefined): ImportedDataState {
  const appState = { ...scene.appState }
  delete appState.collaborators

  const initialData: ImportedDataState = {
    appState: appState as ImportedDataState['appState'],
    elements: scene.elements as ImportedDataState['elements'],
    files: scene.files as ImportedDataState['files'],
  }

  if (libraryItems !== undefined) {
    initialData.libraryItems = libraryItems
  }

  return initialData
}

function sceneFromEditor(elements: unknown, appState: unknown, files: unknown): ExcalidrawScene {
  const json = serializeAsJSON(elements as never, appState as never, files as never, 'local')
  const scene = JSON.parse(json) as ExcalidrawScene
  scene.source = 'excalidraw-minio'
  return scene
}

function hasMissingImageFiles(scene: ExcalidrawScene) {
  return scene.elements.some((element) => {
    if (!element || typeof element !== 'object') {
      return false
    }

    const imageElement = element as { fileId?: unknown; type?: unknown }
    if (imageElement.type !== 'image' || typeof imageElement.fileId !== 'string') {
      return false
    }

    const file = scene.files[imageElement.fileId]
    return (
      !file ||
      typeof file !== 'object' ||
      typeof (file as { dataURL?: unknown }).dataURL !== 'string' ||
      !(file as { dataURL: string }).dataURL
    )
  })
}

function hasPendingImagePlacement(appState: unknown) {
  return (
    Boolean(appState) &&
    typeof appState === 'object' &&
    typeof (appState as { pendingImageElementId?: unknown }).pendingImageElementId === 'string'
  )
}

function parseRoute(): Route {
  const path = window.location.pathname
  const match = path.match(/^\/drawings\/([^/]+)$/)
  if (match) {
    return { id: decodeURIComponent(match[1]), name: 'editor' }
  }
  if (path === '/login') {
    return { name: 'login' }
  }
  return { name: 'list' }
}

function navigate(path: string, setRoute: (route: Route) => void) {
  window.history.pushState(null, '', path)
  setRoute(parseRoute())
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  })

  if (!response.ok) {
    let message = `请求失败：${response.status}`
    try {
      const body = (await response.json()) as { error?: string }
      message = body.error || message
    } catch {
      // Keep the status-based message when the body is empty.
    }
    throw new Error(message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return response.json() as Promise<T>
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(new Date(value))
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [route, setRoute] = useState<Route>(() => parseRoute())

  useEffect(() => {
    const onPopState = () => setRoute(parseRoute())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  useEffect(() => {
    api<{ authenticated: boolean }>('/api/me')
      .then((result) => setAuthenticated(result.authenticated))
      .catch(() => setAuthenticated(false))
  }, [])

  const go = useCallback((path: string) => navigate(path, setRoute), [])

  if (authenticated === null) {
    return <LoadingScreen />
  }

  if (!authenticated || route.name === 'login') {
    return (
      <LoginPage
        onLogin={() => {
          setAuthenticated(true)
          go('/')
        }}
      />
    )
  }

  return (
    <div className="app-shell">
      {route.name === 'editor' ? (
        <EditorPage id={route.id} onBack={() => go('/')} />
      ) : (
        <ListPage
          onCreate={(id) => go(`/drawings/${encodeURIComponent(id)}`)}
          onLogout={async () => {
            await api('/api/logout', { method: 'POST' })
            setAuthenticated(false)
            go('/login')
          }}
          onOpen={(id) => go(`/drawings/${encodeURIComponent(id)}`)}
        />
      )}
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="loading-screen">
      <Loader2 className="spin" size={28} />
    </div>
  )
}

function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [health, setHealth] = useState('检查中')

  useEffect(() => {
    api<{
      storage: { bucketReachable: boolean; missing: string[]; storageConfigured: boolean }
    }>('/api/health')
      .then((result) => {
        if (!result.storage.storageConfigured) {
          setHealth(`缺少配置：${result.storage.missing.join(', ')}`)
          return
        }
        setHealth(result.storage.bucketReachable ? 'MinIO 已连接' : 'MinIO 未连通')
      })
      .catch(() => setHealth('配置检查失败'))
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api('/api/login', {
        body: JSON.stringify({ password }),
        method: 'POST',
      })
      onLogin()
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <form className="login-panel" onSubmit={submit}>
        <div className="brand-row">
          <Cloud size={25} />
          <span>Excalidraw MinIO</span>
        </div>
        <label className="field-label" htmlFor="password">
          密码
        </label>
        <input
          autoFocus
          id="password"
          onChange={(event) => setPassword(event.target.value)}
          placeholder="输入应用密码"
          type="password"
          value={password}
        />
        <div className="status-line">{health}</div>
        {error ? <div className="error-line">{error}</div> : null}
        <button className="primary-button" disabled={loading} type="submit">
          {loading ? <Loader2 className="spin" size={18} /> : null}
          登录
        </button>
      </form>
    </main>
  )
}

function ListPage({
  onCreate,
  onLogout,
  onOpen,
}: {
  onCreate: (id: string) => void
  onLogout: () => void
  onOpen: (id: string) => void
}) {
  const [drawings, setDrawings] = useState<DrawingSummary[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api<{ drawings: DrawingSummary[] }>('/api/drawings')
      setDrawings(result.drawings)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) {
      return drawings
    }
    return drawings.filter((drawing) => drawing.title.toLowerCase().includes(keyword))
  }, [drawings, query])

  async function createDrawing() {
    setCreating(true)
    setError('')
    try {
      const result = await api<{ drawing: DrawingSummary }>('/api/drawings', {
        body: JSON.stringify({ title: '未命名画布' }),
        method: 'POST',
      })
      onCreate(result.drawing.id)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : '新建失败')
    } finally {
      setCreating(false)
    }
  }

  async function removeDrawing(id: string) {
    const target = drawings.find((drawing) => drawing.id === id)
    if (!target || !window.confirm(`删除“${target.title}”？`)) {
      return
    }
    await api(`/api/drawings/${encodeURIComponent(id)}`, { method: 'DELETE' })
    setDrawings((items) => items.filter((item) => item.id !== id))
  }

  return (
    <main className="list-page">
      <header className="topbar">
        <div>
          <h1>画布</h1>
          <p>{drawings.length} 个文件</p>
        </div>
        <div className="toolbar">
          <div className="search-box">
            <Search size={18} />
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题"
              type="search"
              value={query}
            />
          </div>
          <button aria-label="刷新" className="icon-button" onClick={load} title="刷新" type="button">
            <RefreshCw size={18} />
          </button>
          <button className="primary-button" disabled={creating} onClick={createDrawing} type="button">
            {creating ? <Loader2 className="spin" size={18} /> : <FilePlus2 size={18} />}
            新建
          </button>
          <button aria-label="退出" className="icon-button" onClick={onLogout} title="退出" type="button">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      {error ? <div className="banner error-line">{error}</div> : null}
      {loading ? (
        <div className="panel-state">
          <Loader2 className="spin" size={24} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel-state">暂无画布</div>
      ) : (
        <section className="card-grid">
          {filtered.map((drawing) => (
            <article
              className="drawing-card"
              key={drawing.id}
              onClick={() => onOpen(drawing.id)}
              tabIndex={0}
            >
              <div className="card-preview">
                <div className="preview-mark"></div>
              </div>
              <div className="card-body">
                <h2>{drawing.title}</h2>
                <p>{formatTime(drawing.updatedAt)}</p>
                <div className="card-meta">
                  <span>{drawing.elementCount} 个元素</span>
                  <span>{formatBytes(drawing.bytes)}</span>
                </div>
              </div>
              <button
                aria-label="删除"
                className="card-delete"
                onClick={(event) => {
                  event.stopPropagation()
                  void removeDrawing(drawing.id)
                }}
                title="删除"
                type="button"
              >
                <Trash2 size={17} />
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  )
}

function EditorPage({ id, onBack }: { id: string; onBack: () => void }) {
  const [drawing, setDrawing] = useState<DrawingSummary | null>(null)
  const [scene, setScene] = useState<ExcalidrawScene | null>(null)
  const [libraryItems, setLibraryItems] = useState<LibraryItems | undefined | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(
    () => window.localStorage.getItem(AUTOSAVE_STORAGE_KEY) === '1',
  )
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [lastSavedAt, setLastSavedAt] = useState('')
  const sceneRef = useRef<ExcalidrawScene>(emptyScene)
  const saveTimerRef = useRef<number | null>(null)
  const lastSavedJsonRef = useRef('')
  const lastLibraryJsonRef = useRef('')
  const currentSceneJsonRef = useRef('')
  const acceptInitialChangeRef = useRef(false)
  const pendingImagePlacementRef = useRef(false)

  const load = useCallback(async () => {
    setError('')
    const [result, library] = await Promise.all([
      api<{ drawing: DrawingSummary; scene: ExcalidrawScene }>(`/api/drawings/${encodeURIComponent(id)}`),
      api<{ exists: boolean; libraryItems: LibraryItems }>('/api/library'),
    ])
    setDrawing(result.drawing)
    setTitle(result.drawing.title)
    setScene(result.scene)
    setLibraryItems(library.exists ? library.libraryItems : undefined)
    sceneRef.current = result.scene
    currentSceneJsonRef.current = JSON.stringify(result.scene)
    lastSavedJsonRef.current = currentSceneJsonRef.current
    lastLibraryJsonRef.current = library.exists ? JSON.stringify(library.libraryItems) : ''
    acceptInitialChangeRef.current = true
    pendingImagePlacementRef.current = false
    setSaveState('saved')
    setLastSavedAt(formatTime(result.drawing.updatedAt))
  }, [id])

  useEffect(() => {
    void load().catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : '加载失败')
    })
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
      }
    }
  }, [load])

  useEffect(() => {
    window.localStorage.setItem(AUTOSAVE_STORAGE_KEY, autoSaveEnabled ? '1' : '0')
    if (!autoSaveEnabled && saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [autoSaveEnabled])

  const save = useCallback(
    async (nextTitle = title, forceFeedback = false) => {
      const current = sceneRef.current
      const json = currentSceneJsonRef.current || JSON.stringify(current)
      if (pendingImagePlacementRef.current) {
        setSaveState('waiting-files')
        if (forceFeedback) {
          setError('图片还没有放到画布上，不能保存。请先点击画布放置图片。')
        }
        return
      }

      if (hasMissingImageFiles(current)) {
        setSaveState('waiting-files')
        if (forceFeedback) {
          setError('图片文件还没有加载完成，不能保存。请等图片显示正常后再保存。')
        }
        return
      }

      if (json === lastSavedJsonRef.current && nextTitle === drawing?.title) {
        if (forceFeedback) {
          setSaveState('unchanged')
        }
        return
      }

      setSaveState('saving')
      setError('')
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      try {
        const result = await api<{ drawing: DrawingSummary; scene: ExcalidrawScene }>(
          `/api/drawings/${encodeURIComponent(id)}`,
          {
            body: JSON.stringify({ scene: current, title: nextTitle }),
            method: 'PUT',
          },
        )
        setDrawing(result.drawing)
        setLastSavedAt(formatTime(result.drawing.updatedAt))
        lastSavedJsonRef.current = json
        setSaveState('saved')
      } catch (saveError) {
        setSaveState('error')
        setError(saveError instanceof Error ? saveError.message : '保存失败')
      }
    },
    [drawing?.title, id, title],
  )

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current)
    }
    saveTimerRef.current = window.setTimeout(() => {
      void save()
    }, 1200)
  }, [save])

  const saveLibrary = useCallback(async (nextLibraryItems: LibraryItems) => {
    const json = JSON.stringify(nextLibraryItems)
    if (json === lastLibraryJsonRef.current) {
      return
    }

    try {
      const result = await api<{ libraryItems: LibraryItems }>('/api/library', {
        body: JSON.stringify({ libraryItems: nextLibraryItems }),
        method: 'PUT',
      })
      lastLibraryJsonRef.current = JSON.stringify(result.libraryItems)
    } catch (libraryError) {
      setError(libraryError instanceof Error ? `素材库保存失败：${libraryError.message}` : '素材库保存失败')
    }
  }, [])

  const hasUnsavedChanges = useCallback(() => {
    const json = currentSceneJsonRef.current || JSON.stringify(sceneRef.current)
    return json !== lastSavedJsonRef.current || title !== drawing?.title
  }, [drawing?.title, title])

  function backToList() {
    if (hasUnsavedChanges() && !window.confirm('当前画布有未保存内容，确定返回？')) {
      return
    }
    onBack()
  }

  if (!scene || !drawing || libraryItems === null) {
    return (
      <main className="editor-page">
        <div className="panel-state">
          <Loader2 className="spin" size={24} />
        </div>
      </main>
    )
  }

  const saveText =
    saveState === 'saving'
      ? '保存中'
      : saveState === 'saved'
        ? lastSavedAt
          ? `已保存 ${lastSavedAt}`
          : '已保存'
        : saveState === 'error'
          ? '保存失败'
          : saveState === 'unchanged'
            ? '已是最新'
            : saveState === 'waiting-files'
              ? '等待图片文件'
              : '未保存'

  return (
    <main className="editor-page">
      <header className="editor-bar">
        <button aria-label="返回" className="icon-button" onClick={backToList} title="返回" type="button">
          <ArrowLeft size={19} />
        </button>
        <input
          className="title-input"
          onBlur={() => {
            if (autoSaveEnabled) {
              void save(title)
            }
          }}
          onChange={(event) => {
            setTitle(event.target.value)
            setSaveState('idle')
          }}
          value={title}
        />
        <label className="autosave-toggle" title="自动保存">
          <input
            checked={autoSaveEnabled}
            onChange={(event) => setAutoSaveEnabled(event.target.checked)}
            type="checkbox"
          />
          <span className="toggle-track" aria-hidden="true">
            <span className="toggle-thumb"></span>
          </span>
          <span>自动保存</span>
          <strong>{autoSaveEnabled ? '开' : '关'}</strong>
        </label>
        <div className={`save-state ${saveState}`}>{saveText}</div>
        <button className="primary-button" onClick={() => void save(title, true)} type="button">
          {saveState === 'saving' ? <Loader2 className="spin" size={18} /> : <Save size={18} />}
          保存
        </button>
      </header>
      {error ? <div className="banner error-line">{error}</div> : null}
      <section className="canvas-wrap">
        <Excalidraw
          initialData={toInitialData(scene, libraryItems)}
          langCode={EXCALIDRAW_LANG_CODE}
          onLibraryChange={saveLibrary}
          onChange={(elements, appState, files) => {
            if (hasPendingImagePlacement(appState)) {
              pendingImagePlacementRef.current = true
              setSaveState('waiting-files')
              return
            }

            pendingImagePlacementRef.current = false
            const nextScene = sceneFromEditor(elements, appState, files)
            const nextJson = JSON.stringify(nextScene)

            if (nextJson === currentSceneJsonRef.current) {
              return
            }

            sceneRef.current = nextScene
            currentSceneJsonRef.current = nextJson

            if (acceptInitialChangeRef.current) {
              acceptInitialChangeRef.current = false
              lastSavedJsonRef.current = nextJson
              setSaveState(hasMissingImageFiles(nextScene) ? 'waiting-files' : 'saved')
              return
            }

            if (hasMissingImageFiles(nextScene)) {
              setSaveState('waiting-files')
              return
            }

            setError('')

            if (nextJson === lastSavedJsonRef.current) {
              setSaveState('saved')
              return
            }

            setSaveState('idle')
            if (autoSaveEnabled) {
              scheduleSave()
            }
          }}
        />
      </section>
    </main>
  )
}

export default App

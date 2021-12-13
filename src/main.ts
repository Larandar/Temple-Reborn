import { DateTime } from 'luxon';
import "nunjucks";
import { Environment } from "nunjucks";
import {
    App,
    FuzzySuggestModal, MarkdownView, Plugin,
    PluginSettingTab,
    SearchComponent,
    Setting,
    TextComponent,
    TFile
} from "obsidian";
import { FolderSuggest } from "suggest";

interface TempleCoreSettings {
    core: {
        templateDirectory: string
        triggerRenderOnFileCreation: boolean
        filterTemplateSelect: {
            enable: boolean
            regex: string
        }
    }

    datetime: {
        defaultFormat: string
        locale: string
        timezone: string
    }

    zettelkasten: {
        regex: string
    }
}

const DEFAULT_SETTINGS: TempleCoreSettings = {
    core: {
        templateDirectory: "_templates",
        triggerRenderOnFileCreation: true,
        filterTemplateSelect: {
            enable: true,
            regex: "^_",
        },
    },

    datetime: {
        defaultFormat: "yyyy-MM-dd HH:mm",
        locale: "",
        timezone: "",
    },

    zettelkasten: {
        regex: String.raw`^(?<uid>\d+)(?:\b[\s-]+\b(?<title>.*))?$`,
    },
};

class DateTimeParsingError extends Error { }

// TODO[epic=editor]: Add syntax highlighting support

export default class TempleRebornPlugin extends Plugin {
    settings: TempleCoreSettings

    async onload() {
        // Laod plugin settings
        await this.loadSettings();

        // TODO[epic=render-heirarchy]: Add custom template loader based on `obsidian.vault`
        let nunjucks = new Environment()

        // SECTION: DateTime filters
        // TODO[epic=refactor]: Move to dedicated modules

        /**
        * Apply locale and timezone settings, also cast JS Date (returned from other APIs)
        *
        * Since apply is called by all filters that return a DateTime to ensure that
        * settings are respected all implicit conversion and maniputlations should be
        * concentrated here.
        */
        let coerceDateTime = (dt: DateTime | Date | number): DateTime => {
            // Type verification and casting
            if (typeof dt == "number") {
                dt = DateTime.fromMillis(dt as number);
            } else if (dt instanceof Date) {
                dt = DateTime.fromJSDate(dt as Date);
            } else if (!(dt instanceof DateTime)) {
                console.error("Rejected DateTime value:", dt)
                throw TypeError("Only DateTime, Date and ints are accepted for date filters");
            }

            // Apply localization settings
            if (this.settings.datetime.locale) {
                dt = dt.setLocale(this.settings.datetime.locale);
            }
            if (this.settings.datetime.timezone) {
                dt = dt.setZone(this.settings.datetime.timezone);
            }

            return dt;
        }

        nunjucks.addFilter('parseDate', (input, format) => {
            if (!format) throw TypeError("A format is required for parseDate")
            const parsed = DateTime.fromFormat(input, format)
            if (parsed.invalidReason) throw new DateTimeParsingError(`${parsed.invalidReason}: ${parsed.invalidExplanation}`);
            return parsed
        })

        nunjucks.addFilter('now', () => {
            return coerceDateTime(DateTime.local())
        })

        nunjucks.addFilter('today', () => {
            return coerceDateTime(DateTime.local()).startOf("day")
        })

        nunjucks.addFilter('formatDate', (date, format) => {
            return coerceDateTime(date)
                .toFormat(format || this.settings.datetime.defaultFormat)
        })

        // !SECTION

        // SECTION Zettel

        /**
         * Add any groups matching zettel.regex to a zettel object in the context
         *
         * NOTE in case a custom regex does not provide a uid or title group the default ones will be provided
         */
        let zettelkastenContext = (file: TFile) => {
            let defaults = file.basename.match(DEFAULT_SETTINGS.zettelkasten.regex)?.groups
            let custom = file.basename.match(this.settings.zettelkasten.regex)?.groups
            return { ...defaults, ...custom }
        }

        // !SECTION

        // SECTION Rendering

        /**
         * Determine if the current view an active editor
         *
         * @param view Obsidian view object
         * @returns boolean
         */
        let isEditorPanel = (view: MarkdownView) => {
            // FIXME[epic=enhancement]: find a better way to determine if the editor is active
            return view && view.editor && true;
        }


        /**
         * Assemble all the data needed to render a template in a nunjuck's context
         *
         * TODO[epic=enhancement]: Add context provider injuection
         *
         * @param file The file that will be randered
         * @returns A nunjucks context for the template
         */
        let renderContext = (file: TFile): Object => {
            return {
                file,
                zettelkasten: zettelkastenContext(file)
            }
        }

        /**
         * Render a template with the given context
         *
         * TODO[epic=error-handling]: Add error handling
         *
         * @param template The template to render (either a string or a file)
         * @param context Data to render the template with
         * @returns rendered template as a string
         */
        let renderTemplate = async (template: string | TFile, context: object) => {
            if (template instanceof TFile) {
                template = await this.app.vault.read(template)
            }

            return nunjucks.renderString(template, context)
        }

        // !SECTION

        // SECTION: Registering commands

        // Register "Insert Template"
        this.addCommand({
            id: "insert-template",
            name: "Insert Template",
            checkCallback: checking => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView)
                if (checking) return isEditorPanel(view);
                const editor = view.editor;

                // Trick to run async part in a sync callback
                (async () => {
                    let modal = new TemplateSuggestModal(this.app, this)
                    let templateFile: TFile = await modal.open()

                    let renderedTemplate = await renderTemplate(templateFile, renderContext(view.file))

                    // Replace the currently selected portion of the editor
                    editor.replaceSelection(renderedTemplate)
                })()
            },
        });

        // Register "Render File"
        this.addCommand({
            id: "render-file",
            name: "Render File",
            checkCallback: checking => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView)
                if (checking) {
                    return isEditorPanel(view)
                        && view.editor.getSelection().length == 0;
                }


                // Trick to run async part in a sync callback
                (async () => {
                    // If only a part of the file is selected, then we only render that part
                    let templateFile = view.file

                    // Render the template
                    let renderedTemplate = await renderTemplate(templateFile, renderContext(view.file))

                    // Replace the complete file
                    await this.app.vault.modify(view.file, renderedTemplate)
                })()
            }
        })

        // Register "Render Selection"
        this.addCommand({
            id: "render-selection",
            name: "Render Current Selection",
            checkCallback: checking => {
                const view = this.app.workspace.getActiveViewOfType(MarkdownView)
                if (checking) {
                    return isEditorPanel(view)
                        && view.editor.getSelection().length > 0;
                }

                // Trick to run async part in a sync callback
                (async () => {
                    // If only a part of the file is selected, then we only render that part
                    let templateSelection = view.editor.getSelection()

                    // Render the template
                    let renderedTemplate = await renderTemplate(templateSelection, renderContext(view.file))

                    // Replace the currently selected portion of the editor
                    view.editor.replaceSelection(renderedTemplate)
                })()
            }
        })

        // !SECTION

        // Register the setting tab
        this.addSettingTab(new TempleSettingTab(this.app, this));

        // Register event handlers
        // FIXME[epic=render-new-files]: Correctly register and unregister event handlers after vault finished loading
        // this.registerEventHandlers(renderTemplate, renderContext);
    }

    registerEventHandlers(
        renderTemplate: (template: string | TFile, context: object) => Promise<string>,
        renderContext: (file: TFile) => Object,
    ) {
        /**
         * Event handler for triggerRenderOnFileCreation
         *
         * NOTE: This functionality may be out of scope of the extension and it might be
         *       adequate to move it to a dedicated "Automating Commands" extension
         * @param file The file that was created
         */
        this.app.vault.on('create', async (file: TFile) => {
            // Follow settings
            if (!this.settings.core.triggerRenderOnFileCreation) {
                return
            }
            // Only trigger on files
            if (!(file instanceof TFile) || file.extension != "md") {
                return
            }
            // Avoid triggrering for template files (ie when syncing templateDir)
            if (file.path.startsWith(this.settings.core.templateDirectory) && this.settings.core.templateDirectory != "/") {
                return
            }

            // Wait for vault cache to be updated and/or file sync
            await new Promise((resolve, _) => { setTimeout(resolve, 300) })

            let renderedTemplate = await renderTemplate(file, renderContext(file))
            await this.app.vault.modify(file, renderedTemplate)
        })
    }

    /**
     * Load the settings using Obsidian's data API and merge them with the default settings
     */
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    /**
     * Save the settings using Obsidian's data API
     */
    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class TempleSettingTab extends PluginSettingTab {
    plugin: TempleRebornPlugin;

    constructor(app: App, plugin: TempleRebornPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        let { containerEl } = this;

        containerEl.empty();

        // --- Core settings ---
        containerEl.createEl("h2", { text: "Core settings." });

        // core.templateDir
        new Setting(containerEl)
            .setName("Template folder location")
            .setDesc("Files in this directory will be available as templates.")
            .addSearch((search: SearchComponent) => {
                search.setValue(this.plugin.settings.core.templateDirectory)
                search.onChange(async value => {
                    this.plugin.settings.core.templateDirectory = value;
                    await this.plugin.saveSettings();
                })

                new FolderSuggest(this.app, search.inputEl)
            })

        // core.filterTemplateSelect
        // TODO[epic=enhancement]: Add a toggle switch in the same line for filterTemplateSelect.enable
        new Setting(containerEl)
            .setName("Files to exclude from fuzzy search")
            .setDesc("Files matching the regex will be ignored (Default: any file starting by `_`).")
            .addText((text: TextComponent) => {
                text.setValue(this.plugin.settings.core.filterTemplateSelect.regex)
                text.onChange(async value => {
                    this.plugin.settings.core.filterTemplateSelect.regex = value;
                    await this.plugin.saveSettings();
                })
            })

        // core.triggerRenderOnFileCreation
        // TODO[epic=settings]: Add setting for core.triggerRenderOnFileCreation

        // --- Datetime settings ---
        containerEl.createEl("h2", { text: "Datetime settings." });

        // datetime.defaultFormat
        new Setting(containerEl)
            .setName("Default DateTime format")
            .setDesc(`Format to use when using the 'formatDate' filter without argument (Default: ${DEFAULT_SETTINGS.datetime.defaultFormat}).`)
            .addText((text: TextComponent) => {
                text.setValue(this.plugin.settings.datetime.defaultFormat)
                text.onChange(async value => {
                    this.plugin.settings.datetime.defaultFormat = value;
                    await this.plugin.saveSettings();
                })
            })

        // datetime.timezone
        // TODO[epic=settings]: Add setting for datetime.timezone

        // datetime.locale
        // TODO[epic=settings]: Add setting for datetime.locale

        // --- Zettelkasten settings ---

        // zettelkasten.regex
        new Setting(containerEl)
            .setName("Zettelkasten regular expression")
            .setDesc(`Regular expression to use to parse zettelkasten info from the filename (Default: '${DEFAULT_SETTINGS.zettelkasten.regex}').`)
            .addText((text: TextComponent) => {
                text.setValue(this.plugin.settings.zettelkasten.regex)
                text.onChange(async value => {
                    this.plugin.settings.zettelkasten.regex = value;
                    await this.plugin.saveSettings();
                })
            })

    }
}

class TemplateSuggestModal extends FuzzySuggestModal<TFile> {

    constructor(app: App, protected plugin: TempleRebornPlugin) {
        super(app)
    }

    protected promiseResolve: Function = undefined
    protected resolve(item: TFile = undefined): void {
        if (!(this.promiseResolve instanceof Function)) {
            throw new Error(`Temple: Could not resolve suggestion with resolver ${this.promiseResolve}`)
        }
        this.promiseResolve(item)
        this.promiseResolve = () => { }
    }

    async open(): Promise<TFile> {
        super.open()
        return new Promise((resolve, _) => this.promiseResolve = resolve)
    }

    getItems(): TFile[] {
        return this.app.vault.getMarkdownFiles()
            .filter(f => f.path.startsWith(this.plugin.settings.core.templateDirectory))
            .filter(f => !(
                this.plugin.settings.core.filterTemplateSelect.enable &&
                f.basename.match(this.plugin.settings.core.filterTemplateSelect.regex)
            ))
    }
    getItemText(item: TFile): string {
        return item.basename;
    }

    onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent): void {
        // NOTE: What happen to the promise when the modal is closed without choosing
        // NOTE: The `onClose` method is called before the `onChooseItem`
        this.resolve(item)
    }
}

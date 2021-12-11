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
    templateDirectory: string
    filterTemplateSelect: {
        enable: boolean
        regex: string
    }
    datetimeSettings: {
        defaultFormat: string
        locale: string
        timezone: string
    }
}

const DEFAULT_SETTINGS: TempleCoreSettings = {
    templateDirectory: "_templates",
    filterTemplateSelect: {
        enable: true,
        regex: "^_",
    },
    datetimeSettings: {
        defaultFormat: "yyyy-MM-dd HH:mm",
        locale: "",
        timezone: "",
    }
};

class DateTimeParsingError extends Error { }

// TODO[epic=editor]: Add syntax highlighting support

export default class TempleRebornPlugin extends Plugin {
    settings: TempleCoreSettings

    async onload() {
        // Laod plugin settings
        await this.loadSettings();

        let isEditorPanel = (view: MarkdownView) => {
            // If checking then we just want to verify we have access to the editor
            // FIXME[epic=enhancement]: find a way to determine if the editor is active
            return view && view.editor && true;
        }

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
            if (this.settings.datetimeSettings.locale) {
                dt = dt.setLocale(this.settings.datetimeSettings.locale);
            }
            if (this.settings.datetimeSettings.timezone) {
                dt = dt.setZone(this.settings.datetimeSettings.timezone);
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
                .toFormat(format || this.settings.datetimeSettings.defaultFormat)
        })

        // !SECTION


        let renderContext = {}
        let renderTemplate = async (template: string | TFile, context: object) => {
            if (template instanceof TFile) {
                template = await this.app.vault.read(template)
            }

            return nunjucks.renderString(template, context)
        }

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

                    let renderedTemplate = await renderTemplate(templateFile, {
                        file: view.file,
                        ...renderContext
                    })

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
                    let renderedTemplate = await renderTemplate(templateFile, {
                        file: view.file,
                        ...renderContext
                    })

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
                const editor = view.editor;

                // Trick to run async part in a sync callback
                (async () => {
                    let templateSelection = editor.getSelection()

                    let renderedTemplate = await renderTemplate(templateSelection, {
                        file: view.file,
                        ...renderContext
                    })

                    // Replace the currently selected portion of the editor
                    view.editor.replaceSelection(renderedTemplate)
                })()
            }
        })

        // Register the setting tab
        this.addSettingTab(new TempleSettingTab(this.app, this));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

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
                search.setValue(this.plugin.settings.templateDirectory)
                search.onChange(async value => {
                    this.plugin.settings.templateDirectory = value;
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
                text.setValue(this.plugin.settings.filterTemplateSelect.regex)
                text.onChange(async value => {
                    this.plugin.settings.filterTemplateSelect.regex = value;
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
            .filter(f => f.path.startsWith(this.plugin.settings.templateDirectory))
            .filter(f => !(
                this.plugin.settings.filterTemplateSelect.enable &&
                f.basename.match(this.plugin.settings.filterTemplateSelect.regex)
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

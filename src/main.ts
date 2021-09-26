import {
    App,
    Plugin,
    PluginSettingTab,
    SearchComponent,
    Setting,
    TextComponent
} from "obsidian";
import { FolderSuggest } from "suggest";

interface TempleCoreSettings {
    templateDirectory: string
    filterTemplateSelect: {
        enable: boolean
        regex: string
    }
}

const DEFAULT_SETTINGS: TempleCoreSettings = {
    templateDirectory: "_templates",
    filterTemplateSelect: {
        enable: true,
        regex: "^_",
    }
};

export default class TempleRebornPlugin extends Plugin {
    settings: TempleCoreSettings

    async onload() {
        // Laod plugin settings
        await this.loadSettings();

        // Register "Insert Template"
        this.addCommand({
            id: "insert-template",
            name: "Insert Template",
            callback: () => {
                // TODO: Add template insertion
            },
        });

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
        // TODO: Add a toggle switch in the same line for filterTemplateSelect.enable
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

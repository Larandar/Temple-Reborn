import {
    App,
    Plugin,
    PluginSettingTab,
    Setting
} from "obsidian";

interface TempleCoreSettings {
    templateDirectory: string;
}

const DEFAULT_SETTINGS: TempleCoreSettings = {
    templateDirectory: "_templates",
};

export default class TempleRebornPlugin extends Plugin {
    settings: TempleCoreSettings;

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
            .addSearch(search => {
                // TODO: add suggestion
                search.onChange(async value => {
                    this.plugin.settings.templateDirectory = value;
                    await this.plugin.saveSettings();
                })
            })
    }


}

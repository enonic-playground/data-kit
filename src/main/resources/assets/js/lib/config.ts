type UserConfig = {
    key: string;
    displayName: string;
};

export type DataKitConfig = {
    appId: string;
    assetsUri: string;
    toolUri: string;
    apiUris: {
        system: string;
        repositories: string;
    };
    launcherUri: string;
    user: UserConfig | null;
};

const CONFIG_ELEMENT_ID = 'datakit-config';

function readConfig(): DataKitConfig {
    const element = document.getElementById(CONFIG_ELEMENT_ID);
    if (!element) {
        throw new Error(`Config element #${CONFIG_ELEMENT_ID} not found`);
    }

    const text = element.textContent;
    if (!text) {
        throw new Error(`Config element #${CONFIG_ELEMENT_ID} is empty`);
    }

    return JSON.parse(text) as DataKitConfig;
}

let cached: DataKitConfig | undefined;

export function getConfig(): DataKitConfig {
    if (cached == null) {
        cached = readConfig();
    }
    return cached;
}

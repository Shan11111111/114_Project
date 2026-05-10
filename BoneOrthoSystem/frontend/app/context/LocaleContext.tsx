"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
    AppLocale,
    DEFAULT_LOCALE,
    getSavedLocale,
    saveLocale,
    messages,
} from "../lib/i18n";

type LocaleContextType = {
    locale: AppLocale;
    t: Record<string, string>;
    setLocale: (locale: AppLocale) => void;
    toggleLocale: () => void;
};

const LocaleContext = createContext<LocaleContextType>({
    locale: DEFAULT_LOCALE,
    t: messages[DEFAULT_LOCALE],
    setLocale: () => { },
    toggleLocale: () => { },
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
    const [locale, setLocaleState] = useState<AppLocale>(DEFAULT_LOCALE);

    useEffect(() => {
        setLocaleState(getSavedLocale());
    }, []);

    const setLocale = (nextLocale: AppLocale) => {
        setLocaleState(nextLocale);
        saveLocale(nextLocale);

        if (typeof window !== "undefined") {
            window.dispatchEvent(new Event("galabone-locale-changed"));
        }
    };

    const toggleLocale = () => {
        const nextLocale: AppLocale = locale === "zh-TW" ? "en-US" : "zh-TW";
        setLocale(nextLocale);
    };
    const t = useMemo(() => messages[locale], [locale]);

    return (
        <LocaleContext.Provider
            value={{
                locale,
                t,
                setLocale,
                toggleLocale,
            }}
        >
            {children}
        </LocaleContext.Provider>
    );
}

export function useLocale() {
    return useContext(LocaleContext);
}
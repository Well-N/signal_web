plugins {
    id("com.android.application")
}

android {
    namespace = "com.signalweb.android"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.signalweb.android"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/signalweb-assets"))
}

val syncSignalWebAssets by tasks.registering(Copy::class) {
    from(rootProject.file("../pipeline/data/config.desktop.json")) {
        rename { "source-config.json" }
    }
    from(rootProject.file("../pipeline/profiles")) {
        into("profiles")
    }
    into(layout.buildDirectory.dir("generated/signalweb-assets"))
}

tasks.named("preBuild") {
    dependsOn(syncSignalWebAssets)
}

dependencies {
    implementation("androidx.work:work-runtime:2.11.1")
    implementation("org.jsoup:jsoup:1.20.1")
}

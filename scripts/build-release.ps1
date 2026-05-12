$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
Set-Location 'C:\Users\giann\spectra-app\android'
& .\gradlew.bat assembleRelease bundleRelease

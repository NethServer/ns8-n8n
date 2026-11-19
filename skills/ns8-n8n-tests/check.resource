*** Settings ***
Library    Process

*** Keywords ***
Exercise n8n
    [Arguments]    ${phase}    ${node}    ${module}    ${host}    ${state}    ${admin}    ${password}
    ${wrapper}=    Evaluate    str(pathlib.Path(importlib.util.find_spec('Browser').origin).parent / 'wrapper')    modules=pathlib,importlib.util
    ${result}=    Run Process    node    ${CURDIR}/check.cjs    ${phase}
    ...    env:NODE_PATH=${wrapper}/node_modules
    ...    env:NODE_ADDR=${node}    env:MODULE_ID=${module}    env:APP_HOST=${host}
    ...    env:ADMIN_USER=${admin}    env:ADMIN_PASSWORD=${password}    env:FIXTURE_STATE=${state}
    ...    env:QA_IGNORE_TLS=1    env:QA_SCREENSHOT_DIR=${OUTPUT DIR}/browser/screenshot
    ...    timeout=12 minutes    on_timeout=kill
    Should Be Equal As Integers    ${result.rc}    0    msg=${result.stdout}\n${result.stderr}

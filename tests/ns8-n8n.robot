*** Settings ***
Library           OperatingSystem
Library           SSHLibrary
Resource          api.resource

*** Variables ***
${SCENARIO}          install
${RUN_UI_TESTS}      false
${BASELINE_IMAGE}    ghcr.io/nethserver/n8n:0.0.4
# Credentials of the disposable QEMU cluster created by the shared runner.
${ADMIN_USER}        admin
${ADMIN_PASSWORD}    Nethesis,1234

*** Test Cases ***
Qualify the module on a disposable CI node
    Should Be True    $SCENARIO in ('install', 'update')
    IF    '${SCENARIO}' == 'update'
        ${image}=    Set Variable    ${BASELINE_IMAGE}
    ELSE
        ${image}=    Set Variable    ${IMAGE_URL}
    END
    ${install}=    Checked Command    add-module ${image} 1
    ${module}=    Evaluate    ast.literal_eval($install)["module_id"]    modules=ast
    Should Match Regexp    ${module}    ^n8n[0-9]+$
    ${host}=    Set Variable    ${module}.example.com
    ${private_dir}=    Evaluate    tempfile.mkdtemp(prefix="n8n-test-")    modules=tempfile
    TRY
        IF    $RUN_UI_TESTS.lower() == 'true'
            Import Resource    ${CURDIR}/../skills/ns8-n8n-tests/check.resource
            Run Browser Checks    seed    ${module}    ${host}    ${private_dir}/fixture.json
        ELSE
            Run task    module/${module}/configure-module
            ...    {"host":"${host}","timezone":"UTC","http2https":true,"lets_encrypt":false}    decode_json=${False}
        END
        Wait Until Keyword Succeeds    2 min    3 s    Check Running Module    ${module}    ${host}
        IF    '${SCENARIO}' == 'update'
            Checked Command    update-module ${IMAGE_URL} ${module}
        ELSE
            Checked Command    runagent -m ${module} systemctl --user restart n8n.service
        END
        Wait Until Keyword Succeeds    2 min    3 s    Check Running Module    ${module}    ${host}
        Check Candidate Images    ${module}
        Checked Command    runagent -m ${module} sh -c 'test -r "$AGENT_INSTALL_DIR/skills/ns8-n8n-tests/check.resource" && test -r "$AGENT_INSTALL_DIR/skills/ns8-n8n-tests/SKILL.md"'
        IF    $RUN_UI_TESTS.lower() == 'true'
            Run Browser Checks    verify    ${module}    ${host}    ${private_dir}/fixture.json
        END
        # Keep the module available to the QEMU diagnostics job on failure.
        Checked Command    remove-module --no-preserve ${module}
    FINALLY
        Remove Directory    ${private_dir}    recursive=True
    END

*** Keywords ***
Checked Command
    [Arguments]    ${command}
    ${out}    ${error}    ${rc}=    Execute Command    ${command}    return_stderr=True    return_rc=True
    Should Be Equal As Integers    ${rc}    0    ${command} failed! ${error}
    RETURN    ${out}

Check Running Module
    [Arguments]    ${module}    ${host}
    ${cfg}=    Run task    module/${module}/get-configuration    {}
    Should Be Equal    ${cfg}[host]    ${host}
    Should Be Equal    ${cfg}[timezone]    UTC
    Should Be Equal    ${cfg}[http2https]    ${True}
    Should Be Equal    ${cfg}[lets_encrypt]    ${False}
    Checked Command    runagent -m ${module} systemctl --user is-active --quiet n8n.service
    FOR    ${unit}    IN    n8n-pgsql    n8n-server    n8n-runners
        Checked Command    runagent -m ${module} systemctl --user is-active --quiet ${unit}.service
        ${running}=    Checked Command    runagent -m ${module} podman inspect -f '{{.State.Running}}' ${unit}
        Should Be Equal    ${running}    true
    END
    Checked Command    runagent -m ${module} podman exec n8n-pgsql pg_isready -U postgres -d n8n
    Checked Command    curl -fksS --resolve '${host}:443:127.0.0.1' https://${host}/healthz/readiness
    ${redirect}=    Checked Command    curl -sS -o /dev/null -w '\%{redirect_url}' --resolve '${host}:80:127.0.0.1' http://${host}/
    Should Be Equal    ${redirect}    https://${host}/

Check Candidate Images
    [Arguments]    ${module}
    ${images}=    Checked Command    podman image inspect --format '{{index .Labels "org.nethserver.images"}}' ${IMAGE_URL}
    ${pins}=    Evaluate    {ref.rsplit('/', 1)[-1].split(':')[0]: ref for ref in $images.split()}
    FOR    ${container}    ${name}    IN    n8n-pgsql    postgres    n8n-server    n8n    n8n-runners    runners
        ${expected}=    Checked Command    runagent -m ${module} podman image inspect --format '{{.Id}}' ${pins}[${name}]
        ${running}=    Checked Command    runagent -m ${module} podman container inspect --format '{{.Image}}' ${container}
        Should Be Equal    ${running}    ${expected}
    END

Run Browser Checks
    [Arguments]    ${phase}    ${module}    ${host}    ${fixture}
    ${previous}=    Set Log Level    NONE
    TRY
        Exercise n8n    ${phase}    ${NODE_ADDR}    ${module}    ${host}
        ...    ${fixture}    ${ADMIN_USER}    ${ADMIN_PASSWORD}
    FINALLY
        Set Log Level    ${previous}
    END

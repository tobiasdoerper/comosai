import requests
import logging
def get_authenticated_user_details(request_headers):
    user_object = {}

    ## check the headers for the Principal-Id (the guid of the signed in user)
    if "X-Ms-Client-Principal-Id" not in request_headers.keys():
        ## if it's not, assume we're in development mode and return a default user
        from . import sample_user
        raw_user_object = sample_user.sample_user
    else:
        ## if it is, get the user details from the EasyAuth headers
        raw_user_object = {k:v for k,v in request_headers.items()}

    user_object['user_principal_id'] = raw_user_object.get('X-Ms-Client-Principal-Id')
    user_object['user_name'] = raw_user_object.get('X-Ms-Client-Principal-Name')
    user_object['auth_provider'] = raw_user_object.get('X-Ms-Client-Principal-Idp')
    user_object['auth_token'] = raw_user_object.get('X-Ms-Token-Aad-Id-Token')
    user_object['client_principal_b64'] = raw_user_object.get('X-Ms-Client-Principal')
    user_object['aad_id_token'] = raw_user_object.get('X-Ms-Token-Aad-Id-Token')
    get_user_profile_image(user_object['auth_token'])
    return user_object

def get_user_profile_image(access_token):
    graph_endpoint = "https://graph.microsoft.com/v1.0/me/photo/$value"
    logging.debug("tobis", access_token)
    # Setze die Header mit dem Zugriffstoken
    headers = {
        "Authorization": "Bearer " + access_token
    }

    # Mache eine GET-Anfrage, um das Profilbild abzurufen
    response = requests.get(graph_endpoint, headers=headers)
    logging.debug("tobis", response)
    if response.status_code == 200:
        logging.debug("tobis", response)
    return ""